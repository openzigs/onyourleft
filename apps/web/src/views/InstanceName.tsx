// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/KeptVisible';
import { StatusMessage } from '../design/StatusMessage';
import type { InstancePort } from '../instance/instance-port';
import { CHANGE_NAME_TEXT } from './instance-name-text';

export { CHANGE_NAME_TEXT } from './instance-name-text';

/**
 * **Changing your name on an instance, from the app** (#906 item 2). The
 * name is set at *Connect*, and until this the only way to change it was to
 * ask the instance's operator.
 *
 * The press calls `InstancePort.rename`, sealed (`POST /v1/auth/display-name`).
 * The instance keeps each earlier name, and when it changed, with the
 * account, for moderation (owner, 2026-09-30: "earlier names are kept and
 * disclosed"), so {@link CHANGE_NAME_TEXT.earlierNames} is said ABOVE the
 * press, before anything is sent. What the screen then shows as the name is
 * read back from the instance by the parent (`onRenamed`), never the field.
 *
 * ⚠️ Rider-facing wording (`instance-name-text.ts`), quoted in the pull
 * request for the owner's approval.
 */

/** The Instance screen's section, drawn for a rider who is signed in (#906). */
export function InstanceNamePanel({
  port,
  onRenamed,
}: {
  readonly port: Pick<InstancePort, 'rename'>;
  /** The instance kept the new name: read the screen again, so it shows what the instance holds. */
  readonly onRenamed: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [changed, setChanged] = useState(false);
  const nameId = useId();

  async function rename(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setRefusal(undefined);
    setChanged(false);
    const outcome = await port.rename(name);
    setBusy(false);
    if (outcome.kind === 'refused') {
      setRefusal(outcome.text);
      return;
    }
    setName('');
    setChanged(true);
    onRenamed();
  }

  return (
    <section className="oyl-panel" aria-labelledby="oyl-instance-name">
      <h2 id="oyl-instance-name">{CHANGE_NAME_TEXT.heading}</h2>
      <form
        className="oyl-trainer__form"
        aria-label={CHANGE_NAME_TEXT.change}
        onSubmit={(event) => {
          event.preventDefault();
          void rename();
        }}
      >
        <p>
          <label htmlFor={nameId}>{CHANGE_NAME_TEXT.label}</label>{' '}
          <input
            className="oyl-input"
            id={nameId}
            autoComplete="nickname"
            maxLength={64}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setRefusal(undefined);
              setChanged(false);
            }}
          />
        </p>
        <KeptVisible>
          <p className="oyl-note">{CHANGE_NAME_TEXT.earlierNames}</p>
        </KeptVisible>
        <Button type="submit" variant="secondary" disabled={busy}>
          {CHANGE_NAME_TEXT.change}
        </Button>
      </form>
      {changed ? (
        <StatusMessage tone="success" live>
          {CHANGE_NAME_TEXT.changed}
        </StatusMessage>
      ) : null}
      {refusal === undefined ? null : (
        <StatusMessage tone="warning" label="Not changed" live>
          {refusal}
        </StatusMessage>
      )}
    </section>
  );
}
