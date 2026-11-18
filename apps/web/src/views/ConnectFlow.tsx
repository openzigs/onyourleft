// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseInstanceCard } from '@onyourleft/domain';
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';

import type { CameraController } from '../camera/session';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { cardRefusalText, codeWithCard, readCodeWithCard } from '../instance/instance-pin';
import type { ConnectOutcome, InstancePort } from '../instance/instance-port';
import { CardScanner, CONNECT_CHOICE_CLASS } from './CardScanner';
import { OWNER_CLAIM_TEXT, OwnerClaim } from './OwnerClaim';

/**
 * **The Connect screen with no server yet: one scan, then one question** —
 * #2828, the owner's ruling of 2026-11-18.
 *
 * A claim from a server's setup page (#2823), a rider invite (#2826) and
 * another device's *Add another device* line (#773) are the same
 * `<card> <code>` (`instance-pin.ts` §`codeWithCard`), so the app cannot tell
 * them apart. Before #2828 one scan filled three boxes and the rider chose a
 * button; now the screen reads the code ONCE and asks where it came from:
 *
 * 1. **start** — *Scan a code*, large, and *Paste a code instead*; with no
 *    camera, the paste box. An expert's *Enter the address yourself* is a
 *    disclosure under them.
 * 2. **question** — for a card with a code: *My server's setup page* (the
 *    claim), *Someone invited me* (the invite, with an optional name) or
 *    *Another of my devices* (add this device). A plain card skips it.
 * 3. **the answer's step** — its one button, with the refusal directly under
 *    it, and the address taken from the card (an expert may change it in the
 *    step's own *Enter the address yourself*).
 *
 * ## Nothing is sent before a press that says so
 *
 * A scan and a paste send nothing: `readCode` reads the text on this device.
 * Each step that sends says *"Nothing is sent until you press …"* above its
 * button, and the Instance screen keeps what the instance receives on the
 * screen under this flow, open, at every step (`InstanceView.tsx`
 * §`ReceivesBeforeConnect`).
 *
 * ⚠️ **Every sentence here is DRAFT wording for the owner to approve** (#880).
 */

/** What the flow says. Draft wording; the owner's own words are quoted on #2828. */
export const CONNECT_FLOW_TEXT = {
  lead: 'Scan the code your server’s setup page, an invite or another of your devices shows.',
  scan: 'Scan a code',
  pasteInstead: 'Paste a code instead',
  pasteForm: 'Paste a code',
  pasteLabel: 'The code, or the line under it',
  read: 'Continue',
  /** A read that is not a card, nor a card with a code. */
  unreadable:
    'That is not a code this app can use. Scan the code your server’s setup page, an invite or ' +
    'another of your devices shows, or paste the line under it.',
  question: 'Where did this code come from?',
  codeFor: (origin: string) => `The code is for the instance at ${origin}.`,
  choices: {
    claim: 'My server’s setup page',
    invite: 'Someone invited me',
    device: 'Another of my devices',
  },
  again: 'Use another code',
  cardHeading: 'Connect with this card',
  cardFor: (origin: string) => `The card is for the instance at ${origin}.`,
  inviteHeading: 'Join with this invite',
  inviteFor: (origin: string) => `You were invited to the instance at ${origin}.`,
  deviceHeading: 'Add this device',
  deviceFor: (origin: string) =>
    `This device joins the account your other device is signed in to, on the instance at ${origin}.`,
  deviceButton: 'Add this device',
  deviceNothingSent: 'Nothing is sent until you press Add this device.',
  expert: 'Enter the address yourself',
  addressLabel: 'Instance address',
  nameLabel: 'The name other riders will see (optional)',
} as const;

/** Under the expert's address form (#1190, D-14 Q1). Draft. */
export const CONNECT_WITHOUT_CARD =
  'Without the card this device can sign in to an account it already has, but cannot use ' +
  'anything that needs the card.';

/** Nothing leaves until the press. */
export const NOTHING_SENT_UNTIL_CONNECT = 'Nothing is sent until you press Connect.';

/** What a scanned or pasted code is, read on this device: nothing is sent to read it. */
export type CodeRead =
  | { readonly kind: 'line'; readonly line: string; readonly origin: string }
  | { readonly kind: 'card'; readonly card: string; readonly origin: string }
  | { readonly kind: 'refused'; readonly text: string };

/**
 * Read a scan or a paste: a card with a code (a claim, an invite or another
 * device's line — the rider says which), a card alone, or neither. A card
 * that does not parse is refused here in the words a pasted one is
 * (`instance-pin.ts` §`cardRefusalText`), so nothing is asked of an address
 * the card cannot name.
 */
export function readCode(text: string): CodeRead {
  const line = readCodeWithCard(text);
  const card = line?.card ?? text.trim();
  const parsed = parseInstanceCard(card);
  if (!parsed.ok) {
    return {
      kind: 'refused',
      text:
        parsed.problem === 'not-a-card' && line === undefined && !card.startsWith('oyl-instance:')
          ? CONNECT_FLOW_TEXT.unreadable
          : cardRefusalText(parsed.problem),
    };
  }
  return line === undefined
    ? { kind: 'card', card, origin: parsed.card.origin }
    : { kind: 'line', line: codeWithCard(line.card, line.code), origin: parsed.card.origin };
}

type Step =
  | { readonly kind: 'start' }
  | { readonly kind: 'question'; readonly line: string; readonly origin: string }
  | { readonly kind: 'card'; readonly card: string; readonly origin: string }
  | { readonly kind: 'claim'; readonly line: string }
  | { readonly kind: 'invite'; readonly line: string; readonly origin: string }
  | { readonly kind: 'device'; readonly line: string; readonly origin: string };

/** Where a refusal is said: under the button that was pressed. */
type RefusalAt = 'scan' | 'paste' | 'address' | 'step';

/** A step's heading, which takes the focus when the step replaced the control just pressed. */
function StepHeading({
  id,
  focus,
  children,
}: {
  readonly id: string;
  readonly focus: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  // Read once, on mount, as `Button`'s `focusOnMount` (#557).
  const focusFirst = useRef(focus);
  useEffect(() => {
    if (focusFirst.current) heading.current?.focus();
  }, []);
  return (
    <h3 id={id} ref={heading} tabIndex={-1}>
      {children}
    </h3>
  );
}

/** The paste box, which takes the focus as it appears when it replaced the control just pressed. */
function PasteBox({
  id,
  focus,
  value,
  onChange,
}: {
  readonly id: string;
  readonly focus: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  const box = useRef<HTMLTextAreaElement>(null);
  const focusFirst = useRef(focus);
  useEffect(() => {
    if (focusFirst.current) box.current?.focus();
  }, []);
  return (
    <textarea
      ref={box}
      className="oyl-input oyl-instance__card-box"
      id={id}
      rows={3}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

export function ConnectFlow({
  port,
  camera,
  onConnected,
}: {
  readonly port: InstancePort;
  readonly camera?: CameraController | undefined;
  /** Signed in: `claimed` when by the owner's claim, so the screen says whether it owns the server. */
  readonly onConnected: (
    outcome: Extract<ConnectOutcome, { kind: 'connected' }>,
    claimed: boolean,
  ) => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'start' });
  /** A step replaced the control just pressed: its heading takes the focus. */
  const [moved, setMoved] = useState(false);
  const [pasting, setPasting] = useState(camera === undefined);
  const [pasted, setPasted] = useState('');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<
    { readonly at: RefusalAt; readonly text: string } | undefined
  >(undefined);
  /** Said where the screen starts again after a claim's numbers differed (#2823). */
  const [mismatch, setMismatch] = useState(false);
  /** The paste box was opened by its link: it takes the focus as it appears. */
  const [pasteOpened, setPasteOpened] = useState(false);
  const headingId = useId();
  const pasteId = useId();
  const addressId = useId();
  const nameId = useId();

  function go(next: Step): void {
    setRefusal(undefined);
    setMismatch(false);
    setMoved(true);
    if (next.kind === 'card' || next.kind === 'invite') setAddress(next.origin);
    setStep(next);
  }

  function startAgain(): void {
    go({ kind: 'start' });
    setPasted('');
    setAddress('');
    setPasting(camera === undefined);
    setPasteOpened(false);
  }

  /** A scan or a paste, read on this device. */
  function take(text: string, at: 'scan' | 'paste'): void {
    const read = readCode(text);
    if (read.kind === 'refused') {
      setRefusal({ at, text: read.text });
      return;
    }
    go(
      read.kind === 'card'
        ? { kind: 'card', card: read.card, origin: read.origin }
        : { kind: 'question', line: read.line, origin: read.origin },
    );
  }

  async function send(press: () => Promise<ConnectOutcome>, at: RefusalAt): Promise<void> {
    setBusy(true);
    setRefusal(undefined);
    const outcome = await press();
    setBusy(false);
    if (outcome.kind === 'refused') {
      setRefusal({ at, text: outcome.text });
      return;
    }
    onConnected(outcome, false);
  }

  function refusedAt(at: RefusalAt): JSX.Element | null {
    return refusal?.at === at ? (
      <StatusMessage tone="danger" label="Not connected" live>
        {refusal.text}
      </StatusMessage>
    ) : null;
  }

  const again = (
    <p>
      <Button variant="tertiary" disabled={busy} onClick={startAgain}>
        {CONNECT_FLOW_TEXT.again}
      </Button>
    </p>
  );

  const nameField = (
    <p>
      <label htmlFor={nameId}>{CONNECT_FLOW_TEXT.nameLabel}</label>{' '}
      <input
        className="oyl-input"
        id={nameId}
        autoComplete="nickname"
        maxLength={64}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setRefusal(undefined);
        }}
      />
    </p>
  );

  const addressField = (
    <p>
      <label htmlFor={addressId}>{CONNECT_FLOW_TEXT.addressLabel}</label>{' '}
      <input
        className="oyl-input"
        id={addressId}
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder="https://ride.example"
        value={address}
        onChange={(event) => {
          setAddress(event.target.value);
          setRefusal(undefined);
        }}
      />
    </p>
  );

  /** A step that connects with what was read: a plain card, or an invite (#2826). */
  function connectStep(heading: string, lead: string, card: string): JSX.Element {
    return (
      <div key={heading}>
        <StepHeading id={headingId} focus={moved}>
          {heading}
        </StepHeading>
        <p>{lead}</p>
        <form
          className="oyl-connect__form"
          aria-labelledby={headingId}
          onSubmit={(event) => {
            event.preventDefault();
            void send(() => port.connect(address, name, card), 'step');
          }}
        >
          {nameField}
          {/* The address is the card's (#2828); an expert may send it elsewhere. */}
          <details className="oyl-details">
            <summary>{CONNECT_FLOW_TEXT.expert}</summary>
            {addressField}
          </details>
          <p className="oyl-muted">{NOTHING_SENT_UNTIL_CONNECT}</p>
          <Button type="submit" disabled={busy}>
            Connect
          </Button>
          {refusedAt('step')}
        </form>
        {again}
      </div>
    );
  }

  switch (step.kind) {
    case 'question':
      return (
        <div key="question" role="group" aria-labelledby={headingId}>
          <StepHeading id={headingId} focus={moved}>
            {CONNECT_FLOW_TEXT.question}
          </StepHeading>
          <p>{CONNECT_FLOW_TEXT.codeFor(step.origin)}</p>
          {(['claim', 'invite', 'device'] as const).map((kind) => (
            <p key={kind}>
              <Button
                variant="secondary"
                className={CONNECT_CHOICE_CLASS}
                onClick={() => {
                  go(
                    kind === 'claim'
                      ? { kind, line: step.line }
                      : { kind, line: step.line, origin: step.origin },
                  );
                }}
              >
                {CONNECT_FLOW_TEXT.choices[kind]}
              </Button>
            </p>
          ))}
          {again}
        </div>
      );
    case 'card':
      return connectStep(
        CONNECT_FLOW_TEXT.cardHeading,
        CONNECT_FLOW_TEXT.cardFor(step.origin),
        step.card,
      );
    case 'invite':
      return connectStep(
        CONNECT_FLOW_TEXT.inviteHeading,
        CONNECT_FLOW_TEXT.inviteFor(step.origin),
        step.line,
      );
    case 'device':
      return (
        <div key="device" role="group" aria-labelledby={headingId}>
          <StepHeading id={headingId} focus={moved}>
            {CONNECT_FLOW_TEXT.deviceHeading}
          </StepHeading>
          <p>{CONNECT_FLOW_TEXT.deviceFor(step.origin)}</p>
          <p className="oyl-muted">{CONNECT_FLOW_TEXT.deviceNothingSent}</p>
          <p>
            <Button
              disabled={busy}
              onClick={() => {
                void send(() => port.link(step.line), 'step');
              }}
            >
              {CONNECT_FLOW_TEXT.deviceButton}
            </Button>
          </p>
          {refusedAt('step')}
          {again}
        </div>
      );
    case 'claim':
      return (
        <div key="claim">
          <OwnerClaim
            port={port}
            line={step.line}
            focusHeading={moved}
            onSignedIn={(outcome) => {
              onConnected(outcome, true);
            }}
            onMismatch={() => {
              startAgain();
              setMismatch(true);
            }}
          />
          {again}
        </div>
      );
    case 'start':
      break;
  }

  return (
    <div key="start">
      {mismatch ? (
        <StatusMessage tone="warning" label={OWNER_CLAIM_TEXT.mismatchLabel} live>
          {OWNER_CLAIM_TEXT.mismatch}
        </StatusMessage>
      ) : null}
      <p>{CONNECT_FLOW_TEXT.lead}</p>
      {camera === undefined ? null : (
        <>
          <CardScanner
            controller={camera}
            startLabel={CONNECT_FLOW_TEXT.scan}
            primary={!pasting}
            focusOnMount={moved && !pasting}
            onScanned={(text) => {
              // A scan fills nothing and sends nothing: the code is read here,
              // and the rider's next press says what it is for.
              take(text, 'scan');
            }}
          />
          {refusedAt('scan')}
        </>
      )}
      {pasting ? (
        <form
          className="oyl-connect__form"
          // Two forms on one screen are two form landmarks, so each is named
          // (`a11y/audit.ts` §`landmarksAreDistinguishable`).
          aria-label={CONNECT_FLOW_TEXT.pasteForm}
          onSubmit={(event) => {
            event.preventDefault();
            take(pasted, 'paste');
          }}
        >
          <p>
            <label htmlFor={pasteId}>{CONNECT_FLOW_TEXT.pasteLabel}</label>
            <br />
            <PasteBox
              id={pasteId}
              // The start step is drawn anew each time the flow comes back to
              // it, and the box is drawn anew when its link opens it.
              focus={moved || pasteOpened}
              value={pasted}
              onChange={(value) => {
                setPasted(value);
                setRefusal(undefined);
              }}
            />
          </p>
          <Button type="submit">{CONNECT_FLOW_TEXT.read}</Button>
          {refusedAt('paste')}
        </form>
      ) : (
        <p>
          <Button
            variant="tertiary"
            onClick={() => {
              setRefusal(undefined);
              setPasting(true);
              setPasteOpened(true);
            }}
          >
            {CONNECT_FLOW_TEXT.pasteInstead}
          </Button>
        </p>
      )}
      <details className="oyl-details">
        <summary>{CONNECT_FLOW_TEXT.expert}</summary>
        <form
          className="oyl-connect__form"
          aria-label={CONNECT_FLOW_TEXT.expert}
          onSubmit={(event) => {
            event.preventDefault();
            void send(() => port.connect(address, name, ''), 'address');
          }}
        >
          {addressField}
          {nameField}
          <p className="oyl-muted">{CONNECT_WITHOUT_CARD}</p>
          <p className="oyl-muted">{NOTHING_SENT_UNTIL_CONNECT}</p>
          <Button type="submit" variant="secondary" disabled={busy}>
            Connect
          </Button>
          {refusedAt('address')}
        </form>
      </details>
    </div>
  );
}
