// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  currentKeyText,
  KEYS_CARD_PICTURE_LABEL,
  KEYS_CARD_TEXT,
  KEYS_CLI_COMMANDS,
  KEYS_CLI_TEXT,
  KEYS_FINGERPRINT_TEXT,
  KEYS_TEXT,
  KEYS_UNREADABLE_TEXT,
  momentText,
  olderHeldText,
  ROTATE_BUSY_TEXT,
  ROTATE_CONFIRM_WORD,
  ROTATE_KEY_TEXT,
  ROTATE_NOT_DONE_TEXT,
  ROTATE_TYPE_TEXT,
} from '@onyourleft/operate-text';
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import { PairingCode } from '../camera/PairingCode';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import { groupedFingerprint } from '../instance/instance-pin';
import type { OperateKeyRotation, OperateKeysRead, OperatePort } from '../instance/operate-port';

/**
 * **Instance keys** (#2613, epic #2601): the instance card and its identity
 * key's fingerprint, whole, and *Rotate the encryption key*
 * (`GET /v1/operate/keys`, `POST /v1/operate/keys/rotate`).
 *
 * The card is drawn as the Instance screen draws a link code's card
 * (`InstanceKeys.tsx`): one unbroken line of `code`, which `theme.css` lets
 * break where it must so nothing of it is cut off, and the same QR code —
 * here behind *Show the card as a QR code*, drawn once opened, so the
 * section reads the same however soon the code's drawer loads. The
 * fingerprint is grouped in fours, as there.
 *
 * ## What is shown is read back
 *
 * The keys are read as the section opens and again after every rotation,
 * whatever it answered: the serial shown is the instance's.
 *
 * ## Only the routine rotation
 *
 * *Rotate the encryption key* needs the word typed, and the instance refuses
 * a request without it. `--drop-old`, a new identity key and a reset each
 * make every device pin again, or answer a leak, so they stay on the host's
 * command line: the section names them as text and has no control for them.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

export {
  KEYS_UNREADABLE_TEXT,
  ROTATE_BUSY_TEXT,
  ROTATE_KEY_TEXT,
  ROTATE_NOT_DONE_TEXT,
} from '@onyourleft/operate-text';

/** The Keys section: the card, the fingerprint, the current key, and the routine rotation. */
export function OperateKeysPanel({
  port,
}: {
  readonly port: Pick<OperatePort, 'keys' | 'rotateKey'>;
}): JSX.Element {
  const [read, setRead] = useState<OperateKeysRead | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  /** The card's QR code is open. */
  const [pictured, setPictured] = useState(false);
  /** What the last rotation came to, when it was not a rotation. */
  const [refused, setRefused] = useState<OperateKeyRotation | undefined>(undefined);
  const mounted = useRef(true);
  const wordId = useId();

  const reread = useCallback(async (): Promise<void> => {
    const next = await port.keys();
    if (mounted.current) setRead(next);
  }, [port]);

  useEffect(() => {
    mounted.current = true;
    void reread();
    return () => {
      mounted.current = false;
    };
  }, [reread]);

  async function rotate(): Promise<void> {
    const answer = await port.rotateKey(typed.trim());
    if (!mounted.current) return;
    setRefused(answer.kind === 'rotated' ? undefined : answer);
    // Read again whatever the answer: the serial shown is the instance's.
    await reread();
  }

  const heading = (
    <SectionHeading
      level={2}
      id="oyl-operate-keys"
      help={
        <>
          <p>{KEYS_CARD_TEXT}</p>
          <p>{KEYS_FINGERPRINT_TEXT}</p>
          <p>{ROTATE_KEY_TEXT}</p>
        </>
      }
    >
      Instance keys
    </SectionHeading>
  );
  if (read === undefined) {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-keys">
        {heading}
        <p className="oyl-muted">Reading the keys…</p>
      </section>
    );
  }
  if (read.kind !== 'keys') {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-keys">
        {heading}
        <StatusMessage tone="warning" label="Not read" live>
          {KEYS_UNREADABLE_TEXT}
        </StatusMessage>
      </section>
    );
  }
  const ready = read.state === 'ready' && read.card !== null && read.fingerprint !== null;
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-keys">
      {heading}
      {/* Its one control first: the card and its code run past a phone's fold (#666). */}
      <p>
        <Button
          variant="secondary"
          onClick={() => {
            setTyped('');
            setConfirming(true);
          }}
        >
          Rotate the encryption key
        </Button>
      </p>
      {refused === undefined ? null : (
        <StatusMessage tone="warning" label="Not rotated" live>
          {refused.kind === 'busy' ? ROTATE_BUSY_TEXT : ROTATE_NOT_DONE_TEXT}
        </StatusMessage>
      )}
      <dl className="oyl-operate__keys">
        <div>
          <dt>State</dt>
          <dd>{KEYS_TEXT[read.state]}</dd>
        </div>
        {!ready || read.card === null || read.fingerprint === null ? null : (
          <>
            <div>
              <dt>Card</dt>
              <dd>
                <code className="oyl-instance__card">{read.card}</code>
                {/* Drawn once opened: the code's drawer is a module of its own, loaded then. */}
                <details
                  className="oyl-details"
                  onToggle={(event) => {
                    setPictured(event.currentTarget.open);
                  }}
                >
                  <summary>Show the card as a QR code</summary>
                  {pictured ? (
                    <PairingCode code={read.card} label={KEYS_CARD_PICTURE_LABEL} />
                  ) : null}
                </details>
              </dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd>
                <code className="oyl-instance__fingerprint">
                  {groupedFingerprint(read.fingerprint)}
                </code>
              </dd>
            </div>
          </>
        )}
        {read.current === null ? null : (
          <>
            <div>
              <dt>Encryption key</dt>
              <dd>{currentKeyText(read.current.serial, momentText(read.current.createdAt))}</dd>
            </div>
            <div>
              <dt>Rotates by itself</dt>
              <dd>{momentText(read.current.rotatesAt)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Older keys held</dt>
          <dd>{olderHeldText(read.olderHeld)}</dd>
        </div>
      </dl>
      <p>{KEYS_CLI_TEXT}</p>
      <ul className="oyl-operate__keys-cli">
        {KEYS_CLI_COMMANDS.map((each) => (
          <li key={each.command}>
            {each.what}: <code>{each.command}</code>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Rotate the encryption key?"
        confirmLabel="Rotate the encryption key"
        cancelLabel="Keep this key"
        confirmUnavailable={typed.trim() !== ROTATE_CONFIRM_WORD}
        onConfirm={rotate}
      >
        <p>{ROTATE_KEY_TEXT}</p>
        <p className="oyl-field">
          <label htmlFor={wordId}>{ROTATE_TYPE_TEXT}</label>{' '}
          <input
            id={wordId}
            className="oyl-input oyl-input--block"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </p>
      </ConfirmDialog>
    </section>
  );
}
