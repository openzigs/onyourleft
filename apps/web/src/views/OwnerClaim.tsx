// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { ConnectOutcome, InstancePort } from '../instance/instance-port';

/**
 * **Claim your own server from this device** — #2823, ADR 0080 D-3, D-5.
 *
 * The setup page on the owner's server machine shows a claim code beside the
 * server's card, as one QR (#2783, #2784). Since #2828 the Connect screen
 * reads it (`ConnectFlow.tsx`): the owner scans it or pastes the line under
 * it, says it came from the server's setup page, and presses *Claim this
 * server* here:
 *
 * 1. the port checks the card against the server's keys, then sends the code
 *    sealed to them and signed by this device's key
 *    (`instance-port.ts` §`claimOwner`);
 * 2. this step shows the six digits it derived itself, large, in two groups
 *    of three as the setup page does, and asks the owner to check both screens
 *    match;
 * 3. once the owner has said Yes there, *Sign in as the owner* signs this
 *    device in, so the setup page's invite step opens.
 *
 * A claim line is the same `<card> <code>` as a link line or a rider's
 * invite, so it is the rider's answer that says "claim", and the server's
 * that says whether it was one. Every refusal is one sentence, under the
 * button that was pressed, and none names the code.
 *
 * ⚠️ **Every sentence here is DRAFT wording for the owner to approve** (#880).
 */

/** What the claim form and its states say. Draft wording. */
export const OWNER_CLAIM_TEXT = {
  heading: 'Claim your server',
  /** One short line (#1013): what the claim is for is the setup page's to say. */
  lead: 'Make this device the owner of the server whose setup page showed this code.',
  claim: 'Claim this server',
  /** Before the press (#2828): the claim sends nothing until it. */
  nothingSent: 'Nothing is sent until you press Claim this server.',
  compare: 'Check that your server’s setup page shows the same number:',
  then:
    'If it does, press Yes on the setup page, then Sign in as the owner here. If it does not, ' +
    'press No there, then It shows another number here.',
  signIn: 'Sign in as the owner',
  differs: 'It shows another number',
  mismatch:
    'Then press No on your server’s setup page if you have not yet, show a new claim code there ' +
    'and scan it again.',
  /** What the code was spent on, said where the screen starts again (#2828). */
  mismatchLabel: 'Not claimed',
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

/** What {@link OwnerClaim} tells the screen around it. */
export interface ClaimProgress {
  readonly busy: boolean;
  readonly pending: boolean;
}

export function OwnerClaim({
  port,
  line,
  focusHeading,
  onSignedIn,
  onMismatch,
  onProgress,
}: {
  readonly port: InstancePort;
  /** The line the rider scanned or pasted, which they said a setup page showed. */
  readonly line: string;
  /** Focus the heading as it first appears: it replaced the answer just pressed. */
  readonly focusHeading: boolean;
  /** Signed in as the claimed owner: the screen reads the instance again. */
  readonly onSignedIn: (outcome: Extract<ConnectOutcome, { kind: 'connected' }>) => void;
  /** The owner said the numbers differ: the code is spent, and the screen starts again. */
  readonly onMismatch: () => void;
  /**
   * Where the claim stands, for a control outside it: a press is in flight, or
   * the code is spent and its numbers are on the screen waiting for the answer.
   */
  readonly onProgress: (progress: ClaimProgress) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<
    { readonly comparisonCode: string; readonly card: string } | undefined
  >(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    onProgress({ busy, pending: pending !== undefined });
  }, [busy, pending, onProgress]);

  // On mount only, as `Button`'s `focusOnMount` (#557): read once, so a
  // later render does not move focus that the rider has moved since.
  const focusFirst = useRef(focusHeading);
  useEffect(() => {
    if (focusFirst.current) heading.current?.focus();
  }, []);

  async function claim(): Promise<void> {
    setBusy(true);
    setRefusal(undefined);
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

  // #2828: directly under the button that was pressed.
  const refused =
    refusal === undefined ? null : (
      <StatusMessage tone="danger" label="Not claimed" live>
        {refusal}
      </StatusMessage>
    );

  if (pending !== undefined) {
    const [first, second] = comparisonGroups(pending.comparisonCode);
    // Keyed apart from the claim's own step, so the digits' buttons are new
    // ones: *Sign in as the owner* takes the focus as it appears (#557), and
    // is never the *Claim this server* node React would otherwise reuse.
    return (
      <div key="pending" aria-labelledby={headingId} role="group">
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
          </Button>
        </p>
        {refused}
        <p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              // The code is spent on the server: neither it nor the digits stay here.
              onMismatch();
            }}
          >
            {OWNER_CLAIM_TEXT.differs}
          </Button>
        </p>
      </div>
    );
  }

  return (
    <div key="claim" aria-labelledby={headingId} role="group">
      <h3 id={headingId} ref={heading} tabIndex={-1}>
        {OWNER_CLAIM_TEXT.heading}
      </h3>
      <p>{OWNER_CLAIM_TEXT.lead}</p>
      <p className="oyl-muted">{OWNER_CLAIM_TEXT.nothingSent}</p>
      <p>
        <Button
          disabled={busy}
          onClick={() => {
            void claim();
          }}
        >
          {OWNER_CLAIM_TEXT.claim}
        </Button>
      </p>
      {refused}
    </div>
  );
}
