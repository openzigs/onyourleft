// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { PairingCode } from '../camera/PairingCode';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { groupedFingerprint } from '../instance/instance-pin';
import type {
  CardOutcome,
  InstancePort,
  KeysOutcome,
  LinkCodeOutcome,
} from '../instance/instance-port';

/**
 * **The instance's key, on the Instance screen** — #1190, ADR 0047 D-5, D-6.
 *
 * Three things a connected device does with the instance's identity key:
 *
 * - **the card-entry form** — paste the instance card (scanned or pasted
 *   inside the app, never opened as a link: D-6). On a device with no pin it
 *   is pinned once the instance's keys verify under it;
 * - **the confirm-new-card screen** — a card that differs from the pin is
 *   shown beside it, both fingerprints whole, and kept only when the rider
 *   presses *Confirm the new card* (D-6, D-14 Q8);
 * - **Add another device** — a link code with THIS device's card beside it,
 *   as one line and one QR code (#773, D-6 source 2). The card is the port's,
 *   composed from the stored pin, never from an instance answer.
 *
 * ⚠️ **Every sentence here is DRAFT wording for the owner to approve** (D-14
 * Q6, #880).
 */

/** The heading of the section. */
export const INSTANCE_KEY_HEADING = 'The instance’s key';

/** What a pinned, trusted device is told. Draft. */
export const INSTANCE_KEY_PINNED =
  'This device checks every key the instance offers against the card it was given. The card’s ' +
  'fingerprint is:';

/** What the card box is for. Draft. */
export const CARD_FIELD_LABEL = 'The instance’s card';
/** What the card box says before anything is typed. Draft. */
export const CARD_FIELD_HINT =
  'Paste the whole card, starting oyl-instance:. Get it from the instance’s operator, or from the ' +
  'Instance screen of another of your devices.';

/** Under the link code. Draft. */
export const LINK_CODE_LEAD =
  'On your other device, open Instance and paste this line, or point its camera at the code. It ' +
  'carries this device’s card, so the other device checks the instance’s key as this one does. ' +
  'It works once, until';

/** What the QR code is for: its accessible name. */
export const LINK_CODE_PICTURE_LABEL = 'Link code and the instance’s card, for your other device';

/** A time in UTC, so the screen says the same thing wherever it is read. */
function clockTime(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(11, 16)} UTC`;
}

function Fingerprint({ value }: { readonly value: string }): JSX.Element {
  return <code className="oyl-instance__fingerprint">{groupedFingerprint(value)}</code>;
}

/** The confirm-new-card screen: both fingerprints whole, and the rider's choice. */
export function ConfirmNewCard({
  outcome,
  busy,
  onConfirm,
  onKeep,
}: {
  readonly outcome: Extract<CardOutcome, { kind: 'confirm' }>;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onKeep: () => void;
}): JSX.Element {
  const headingId = useId();
  return (
    <section className="oyl-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>Confirm the new card</h3>
      <StatusMessage tone="warning" label="A different key">
        {outcome.text}
      </StatusMessage>
      <dl className="oyl-instance__facts">
        <dt>The card this device has</dt>
        <dd>
          <Fingerprint value={outcome.pinned} />
        </dd>
        <dt>The new card</dt>
        <dd>
          <Fingerprint value={outcome.offered} />
        </dd>
      </dl>
      <p className="oyl-ride__actions">
        <Button disabled={busy} onClick={onConfirm}>
          Confirm the new card
        </Button>{' '}
        <Button variant="secondary" disabled={busy} onClick={onKeep}>
          Keep the card this device has
        </Button>
      </p>
    </section>
  );
}

/** The card-entry form. */
export function CardEntry({
  busy,
  onOffer,
}: {
  readonly busy: boolean;
  readonly onOffer: (card: string) => void;
}): JSX.Element {
  const [card, setCard] = useState('');
  const fieldId = useId();
  const hintId = useId();
  return (
    <form
      className="oyl-trainer__form"
      onSubmit={(event) => {
        event.preventDefault();
        onOffer(card);
      }}
    >
      <p>
        <label htmlFor={fieldId}>{CARD_FIELD_LABEL}</label>
        <br />
        <textarea
          className="oyl-input oyl-instance__card-box"
          id={fieldId}
          rows={3}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-describedby={hintId}
          value={card}
          onChange={(event) => {
            setCard(event.target.value);
          }}
        />
      </p>
      <p className="oyl-muted" id={hintId}>
        {CARD_FIELD_HINT}
      </p>
      <Button type="submit" variant="secondary" disabled={busy}>
        Use this card
      </Button>
    </form>
  );
}

function LinkCode({ outcome }: { readonly outcome: LinkCodeOutcome }): JSX.Element {
  if (outcome.kind === 'unavailable') {
    return (
      <StatusMessage tone="warning" live>
        {outcome.text}
      </StatusMessage>
    );
  }
  return (
    <div>
      <p>
        {LINK_CODE_LEAD} {clockTime(outcome.expiresAt)}.
      </p>
      <p>
        <code className="oyl-instance__card">{outcome.offer}</code>
      </p>
      <PairingCode code={outcome.offer} label={LINK_CODE_PICTURE_LABEL} />
    </div>
  );
}

/** The instance's key, for a connected device. */
export function InstanceKeys({ port }: { readonly port: InstancePort }): JSX.Element {
  const [keys, setKeys] = useState<KeysOutcome | undefined>(undefined);
  const [card, setCard] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<
    Extract<CardOutcome, { kind: 'confirm' }> | undefined
  >(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [linkCode, setLinkCode] = useState<LinkCodeOutcome | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const headingId = useId();

  const read = useCallback(async (): Promise<void> => {
    setKeys(await port.keys());
  }, [port]);

  useEffect(() => {
    void read();
  }, [read]);

  async function offer(text: string): Promise<void> {
    setBusy(true);
    setRefusal(undefined);
    setConfirming(undefined);
    const outcome = await port.offerCard(text);
    setBusy(false);
    if (outcome.kind === 'refused') setRefusal(outcome.text);
    else if (outcome.kind === 'confirm') {
      setCard(text);
      setConfirming(outcome);
    } else await read();
  }

  async function confirm(): Promise<void> {
    if (card === undefined) return;
    setBusy(true);
    const outcome = await port.confirmCard(card);
    setBusy(false);
    setConfirming(undefined);
    setCard(undefined);
    if (outcome.kind === 'refused') setRefusal(outcome.text);
    await read();
  }

  async function showLinkCode(): Promise<void> {
    setBusy(true);
    setLinkCode(await port.linkCode());
    setBusy(false);
  }

  if (keys === undefined) {
    return <p className="oyl-muted">Checking the instance’s key…</p>;
  }

  return (
    <section className="oyl-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{INSTANCE_KEY_HEADING}</h2>
      {keys.kind === 'trusted' ? (
        <>
          <p>
            {INSTANCE_KEY_PINNED} <Fingerprint value={keys.pinned} />
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void showLinkCode();
            }}
          >
            Add another device
          </Button>
          {linkCode === undefined ? null : <LinkCode outcome={linkCode} />}
        </>
      ) : (
        <>
          <StatusMessage
            tone={keys.kind === 'no-card' ? 'warning' : 'danger'}
            label={keys.kind === 'no-card' ? 'No card' : 'Nothing is sent'}
            live
          >
            {keys.text}
          </StatusMessage>
          {keys.kind === 'needs-new-card' ? (
            <dl className="oyl-instance__facts">
              <dt>The card this device has</dt>
              <dd>
                <Fingerprint value={keys.pinned} />
              </dd>
              <dt>The new key the instance announced</dt>
              <dd>
                <Fingerprint value={keys.expected} />
              </dd>
            </dl>
          ) : null}
        </>
      )}
      {confirming === undefined ? null : (
        <ConfirmNewCard
          outcome={confirming}
          busy={busy}
          onConfirm={() => {
            void confirm();
          }}
          onKeep={() => {
            setConfirming(undefined);
            setCard(undefined);
          }}
        />
      )}
      {refusal === undefined ? null : (
        <StatusMessage tone="danger" label="Card not used" live>
          {refusal}
        </StatusMessage>
      )}
      <CardEntry
        busy={busy}
        onOffer={(text) => {
          void offer(text);
        }}
      />
    </section>
  );
}
