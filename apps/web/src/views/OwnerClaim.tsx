// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useRef, useState, type JSX } from 'react';

import type { CameraController } from '../camera/session';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { ConnectOutcome, InstancePort } from '../instance/instance-port';
import { CardScanner } from './CardScanner';

/**
 * **Claim your own server from this device** — #2823, ADR 0080 D-3, D-5.
 *
 * The setup page on the owner's server machine shows a claim code beside the
 * server's card, as one QR (#2783, #2784). Here the owner scans it or pastes
 * the line under it, and presses *Claim this server*:
 *
 * 1. the port checks the card against the server's keys, then sends the code
 *    sealed to them and signed by this device's key
 *    (`instance-port.ts` §`claimOwner`);
 * 2. this screen shows the six digits it derived itself, large, in two groups
 *    of three as the setup page does, and asks the owner to check both screens
 *    match;
 * 3. once the owner has said Yes there, *Sign in as the owner* signs this
 *    device in, so the setup page's invite step opens.
 *
 * A claim line is the same `<card> <code>` as a link line or a rider's
 * invite, so it is this box that says "claim", and the server's answer that
 * says whether it was one. Every refusal is one sentence, and none names the
 * code.
 *
 * ⚠️ **Every sentence here is DRAFT wording for the owner to approve** (#880).
 */

/** What the claim form and its states say. Draft wording. */
export const OWNER_CLAIM_TEXT = {
  heading: 'Claim your server',
  /** One short line (#1013): what the claim is for is the setup page's to say. */
  lead: 'Setting up your own server? Scan the claim code its setup page shows, or paste the line under it.',
  label: 'The claim code from your server’s setup page',
  scan: 'Scan the claim code with the camera',
  claim: 'Claim this server',
  compare: 'Check that your server’s setup page shows the same number:',
  then:
    'If it does, press Yes on the setup page, then Sign in as the owner here. If it does not, ' +
    'press No there, then It shows another number here.',
  signIn: 'Sign in as the owner',
  differs: 'It shows another number',
  mismatch:
    'Then press No on your server’s setup page if you have not yet, show a new claim code there ' +
    'and scan it again.',
  /** Once signed in, and the server says this device owns it. */
  owned: 'This device now owns your server, so go back to its setup page and press Next step.',
  /** Once signed in, but the server does not say this device owns it. */
  'not-owner':
    'This device is signed in, but your server has not made it the owner yet: press Yes on its ' +
    'setup page, then come back to this screen.',
} as const;

/** The six digits as the setup page draws them: two groups of three. */
export function comparisonGroups(code: string): readonly [string, string] {
  return [code.slice(0, 3), code.slice(3)];
}

export function OwnerClaim({
  port,
  camera,
  line,
  onLineChange,
  onSignedIn,
}: {
  readonly port: InstancePort;
  readonly camera?: CameraController | undefined;
  /** The box's text: the Connect form's scanner may fill it too (`InstanceView.tsx`). */
  readonly line: string;
  readonly onLineChange: (line: string) => void;
  /** Signed in as the claimed owner: the screen reads the instance again. */
  readonly onSignedIn: (outcome: Extract<ConnectOutcome, { kind: 'connected' }>) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<
    { readonly comparisonCode: string; readonly card: string } | undefined
  >(undefined);
  /** The owner said the numbers differ: focus goes back to the box. */
  const [cleared, setCleared] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const boxId = useId();
  const headingId = useId();

  useEffect(() => {
    if (cleared) box.current?.focus();
  }, [cleared]);

  async function claim(): Promise<void> {
    setBusy(true);
    setRefusal(undefined);
    setCleared(false);
    const outcome = await port.claimOwner(line);
    setBusy(false);
    if (outcome.kind === 'refused') {
      setRefusal(outcome.text);
      return;
    }
    setPending({ comparisonCode: outcome.comparisonCode, card: outcome.card });
  }

  async function signIn(card: string): Promise<void> {
    setBusy(true);
    setRefusal(undefined);
    const outcome = await port.signInAsOwner(card);
    setBusy(false);
    if (outcome.kind === 'refused') {
      setRefusal(outcome.text);
      return;
    }
    onSignedIn(outcome);
  }

  const refused =
    refusal === undefined ? null : (
      <StatusMessage tone="danger" label="Not claimed" live>
        {refusal}
      </StatusMessage>
    );

  if (pending !== undefined) {
    const [first, second] = comparisonGroups(pending.comparisonCode);
    return (
      <div aria-labelledby={headingId} role="group">
        <h3 id={headingId}>{OWNER_CLAIM_TEXT.heading}</h3>
        <div role="status">
          <p>{OWNER_CLAIM_TEXT.compare}</p>
          <p className="oyl-instance__compare">
            <strong>{first}</strong> <strong>{second}</strong>
          </p>
        </div>
        <p>{OWNER_CLAIM_TEXT.then}</p>
        <p>
          <Button
            disabled={busy}
            focusOnMount
            onClick={() => {
              void signIn(pending.card);
            }}
          >
            {OWNER_CLAIM_TEXT.signIn}
          </Button>{' '}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              // The code is spent on the server: neither it nor the digits stay here.
              setPending(undefined);
              onLineChange('');
              setRefusal(OWNER_CLAIM_TEXT.mismatch);
              setCleared(true);
            }}
          >
            {OWNER_CLAIM_TEXT.differs}
          </Button>
        </p>
        {refused}
      </div>
    );
  }

  return (
    <>
      <h3 id={headingId}>{OWNER_CLAIM_TEXT.heading}</h3>
      <form
        className="oyl-trainer__form"
        aria-labelledby={headingId}
        onSubmit={(event) => {
          event.preventDefault();
          void claim();
        }}
      >
        <p>{OWNER_CLAIM_TEXT.lead}</p>
        <p>
          <label htmlFor={boxId}>{OWNER_CLAIM_TEXT.label}</label>
          <br />
          <textarea
            ref={box}
            className="oyl-input oyl-instance__card-box"
            id={boxId}
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            value={line}
            onChange={(event) => {
              onLineChange(event.target.value);
              setRefusal(undefined);
            }}
          />
        </p>
        {camera === undefined ? null : (
          <CardScanner
            controller={camera}
            startLabel={OWNER_CLAIM_TEXT.scan}
            onScanned={(text) => {
              // A scan fills the box, as a paste would, and sends nothing: the press does.
              setRefusal(undefined);
              onLineChange(text.trim());
            }}
          />
        )}
        {/* Secondary, as Add this device is: Connect is the screen's one primary (#668). */}
        <Button type="submit" variant="secondary" disabled={busy}>
          {OWNER_CLAIM_TEXT.claim}
        </Button>
      </form>
      {refused}
    </>
  );
}
