// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The Instance screen's section for a hosted model service on the rider's
 * own key** — [#1251](https://github.com/openzigs/onyourleft/issues/1251).
 *
 * Three things, in the order a rider does them:
 *
 * 1. **Store a key** — the service's address, the model's name, the key, and
 *    (for a model that reasons, #1268) what it may spend reasoning. Beside the
 *    key box, never behind it: that whoever runs the instance could read the
 *    key (#1104 B2), and that it is accepted only sealed.
 * 2. **Agree** — a switch, off until the rider turns it on, with the whole
 *    consent (#1104 B1) BESIDE it and naming the service by the address the
 *    instance says the key is for. Never an address typed here: the consent
 *    names what the instance would really send to.
 * 3. **Send a test question** — offered only once both are held.
 *
 * ⚠️ **Every sentence is in `hosted-consent.ts`**, DRAFT until the owner
 * approves it; nothing rider-facing is written in this file.
 *
 * ⚠️ **What is shown is what the instance says** (`InstanceView.tsx`'s rule):
 * after every press the section redraws from the instance's own answer, never
 * from the form. The key box is emptied as soon as the key is sent, and
 * nothing here can show a key again.
 *
 * It asks the instance what it holds when it is drawn, as the Instance screen
 * already does for the rider's devices; that request goes to the rider's own
 * instance, sealed, and to no service.
 */

import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/KeptVisible';
import { StatusMessage } from '../design/StatusMessage';
import {
  HOSTED_ADDRESS_HINT,
  HOSTED_ADDRESS_LABEL,
  HOSTED_AGREED,
  HOSTED_AGREED_TEXT,
  HOSTED_KEY_LABEL,
  HOSTED_KEY_OPERATOR_CAN_READ,
  HOSTED_KEY_REMOVED,
  HOSTED_KEY_SEALED_ONLY,
  HOSTED_KEY_STORED,
  HOSTED_MODEL_HINT,
  HOSTED_MODEL_LABEL,
  HOSTED_NO_KEY,
  HOSTED_PANEL_HEADING,
  HOSTED_PANEL_LEAD,
  HOSTED_READING,
  HOSTED_REASONING_HINT,
  HOSTED_REASONING_LABEL,
  HOSTED_REMOVE_BUTTON,
  HOSTED_STORE_BUTTON,
  HOSTED_TEST_BUTTON,
  HOSTED_TESTING,
  HOSTED_UNREADABLE,
  HOSTED_WITHDRAWN,
  hostedAgreeLabel,
  hostedConsentElsewhere,
  hostedConsentMoved,
  hostedConsentWithoutKey,
  hostedInstanceConsent,
  hostedKeyHeldText,
  hostedTestText,
  hostedWithdrawLabel,
} from './hosted-consent';
import type {
  HostedSettings,
  HostedSettingsOutcome,
  HostedSettingsPort,
} from './hosted-settings-port';

type Message = { readonly tone: 'success' | 'info' | 'warning' | 'danger'; readonly text: string };

/** The host of an origin the instance named, or the origin whole if it cannot be read. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function HostedServicePanel({ port }: { readonly port: HostedSettingsPort }): JSX.Element {
  const [settings, setSettings] = useState<HostedSettings | undefined>(undefined);
  const [unread, setUnread] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<Message | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [reasoning, setReasoning] = useState('');
  const addressId = useId();
  const addressHintId = useId();
  const modelId = useId();
  const modelHintId = useId();
  const keyId = useId();
  const keyHintId = useId();
  const reasoningId = useId();
  const reasoningHintId = useId();
  const consentId = useId();

  /** Run one press: redraw from what the instance answered, or say why it did not. */
  const run = useCallback(
    async (
      press: () => Promise<HostedSettingsOutcome>,
      said: (now: HostedSettings) => Message | undefined,
    ): Promise<boolean> => {
      setBusy(true);
      setMessage(undefined);
      let outcome: HostedSettingsOutcome;
      try {
        outcome = await press();
      } catch {
        outcome = { kind: 'failed', text: HOSTED_UNREADABLE };
      }
      setBusy(false);
      if (outcome.kind === 'failed') {
        setMessage({ tone: 'warning', text: outcome.text });
        return false;
      }
      setUnread(undefined);
      setSettings(outcome.settings);
      setMessage(said(outcome.settings));
      return true;
    },
    [],
  );

  useEffect(() => {
    let current = true;
    port.readHostedSettings().then(
      (outcome) => {
        if (!current) return;
        if (outcome.kind === 'held') setSettings(outcome.settings);
        else setUnread(outcome.text);
      },
      () => {
        if (current) setUnread(HOSTED_UNREADABLE);
      },
    );
    return () => {
      current = false;
    };
  }, [port]);

  const store = async (): Promise<void> => {
    const agreedBefore = settings?.consent?.origin;
    const stored = await run(
      () => port.storeHostedKey({ address, model, key, reasoningTokens: reasoning }),
      (now) =>
        agreedBefore !== undefined && now.consent === null && now.key !== null
          ? { tone: 'warning', text: hostedConsentMoved(hostOf(agreedBefore), now.key.host) }
          : { tone: 'success', text: HOSTED_KEY_STORED },
    );
    // Sent or not, the key does not stay in the box once the instance holds one.
    if (stored) {
      setKey('');
      setAddress('');
      setModel('');
      setReasoning('');
    }
  };

  const test = async (host: string, allowanceSet: boolean): Promise<void> => {
    setBusy(true);
    setMessage({ tone: 'info', text: HOSTED_TESTING });
    let text: string;
    let answered = false;
    try {
      const outcome = await port.sendHostedTestQuestion();
      if (outcome.kind === 'failed') text = outcome.text;
      else {
        answered = outcome.result === 'answered';
        text = hostedTestText(outcome.result, host, { reasoned: outcome.reasoned, allowanceSet });
      }
    } catch {
      text = HOSTED_UNREADABLE;
    }
    setBusy(false);
    setMessage({ tone: answered ? 'success' : 'warning', text });
  };

  const heldKey = settings?.key ?? null;
  const agreed = settings?.consent?.origin;
  const agreedHere = heldKey !== null && agreed === heldKey.origin;
  const consent = heldKey === null ? undefined : hostedInstanceConsent(heldKey.origin);

  return (
    <section className="oyl-panel" aria-labelledby="oyl-hosted-service">
      <h2 id="oyl-hosted-service">{HOSTED_PANEL_HEADING}</h2>
      {/* What this is and that nothing goes anywhere yet — never tucked (#666). */}
      <KeptVisible>
        <p>{HOSTED_PANEL_LEAD}</p>
      </KeptVisible>
      {settings === undefined ? (
        unread === undefined ? (
          <p className="oyl-muted">{HOSTED_READING}</p>
        ) : (
          <StatusMessage tone="warning">{unread}</StatusMessage>
        )
      ) : (
        <>
          <h3>Your key</h3>
          <p>{heldKey === null ? HOSTED_NO_KEY : hostedKeyHeldText(heldKey)}</p>
          <form
            className="oyl-trainer__form"
            aria-label={HOSTED_STORE_BUTTON}
            onSubmit={(event) => {
              event.preventDefault();
              void store();
            }}
          >
            <p>
              <label htmlFor={addressId}>{HOSTED_ADDRESS_LABEL}</label>{' '}
              <input
                className="oyl-input"
                id={addressId}
                type="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby={addressHintId}
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                }}
              />
            </p>
            <p className="oyl-muted" id={addressHintId}>
              {HOSTED_ADDRESS_HINT}
            </p>
            <p>
              <label htmlFor={modelId}>{HOSTED_MODEL_LABEL}</label>{' '}
              <input
                className="oyl-input"
                id={modelId}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby={modelHintId}
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                }}
              />
            </p>
            <p className="oyl-muted" id={modelHintId}>
              {HOSTED_MODEL_HINT}
            </p>
            <p>
              <label htmlFor={keyId}>{HOSTED_KEY_LABEL}</label>{' '}
              <input
                className="oyl-input"
                id={keyId}
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby={keyHintId}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                }}
              />
            </p>
            {/* #1104 B2 and B6: who could read the key, and how it travels. Beside the box. */}
            <KeptVisible>
              <p id={keyHintId}>
                {HOSTED_KEY_OPERATOR_CAN_READ} {HOSTED_KEY_SEALED_ONLY}
              </p>
            </KeptVisible>
            <p>
              <label htmlFor={reasoningId}>{HOSTED_REASONING_LABEL}</label>{' '}
              <input
                className="oyl-input"
                id={reasoningId}
                inputMode="numeric"
                autoComplete="off"
                aria-describedby={reasoningHintId}
                value={reasoning}
                onChange={(event) => {
                  setReasoning(event.target.value);
                }}
              />
            </p>
            <p className="oyl-muted" id={reasoningHintId}>
              {HOSTED_REASONING_HINT}
            </p>
            <Button variant="secondary" type="submit" disabled={busy}>
              {HOSTED_STORE_BUTTON}
            </Button>
          </form>
          {heldKey?.setBy === 'app' ? (
            <p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void run(
                    () => port.removeHostedKey(),
                    () => ({ tone: 'success', text: HOSTED_KEY_REMOVED }),
                  );
                }}
              >
                {HOSTED_REMOVE_BUTTON}
              </Button>
            </p>
          ) : null}

          {/* A consent the key no longer matches: said, and withdrawable, whatever else is shown. */}
          {agreed !== undefined && !agreedHere ? (
            <>
              <StatusMessage tone="warning">
                {heldKey === null
                  ? hostedConsentWithoutKey(hostOf(agreed))
                  : hostedConsentElsewhere(hostOf(agreed), heldKey.host)}
              </StatusMessage>
              <p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void run(
                      () => port.withdrawHostedAgreement(),
                      () => ({ tone: 'success', text: HOSTED_WITHDRAWN }),
                    );
                  }}
                >
                  {hostedWithdrawLabel(hostOf(agreed))}
                </Button>
              </p>
            </>
          ) : null}

          {heldKey === null || consent === undefined ? null : (
            <>
              <h3>Your agreement</h3>
              {/* #1104 B1, whole, beside the switch it is consent to. Never tucked. */}
              <KeptVisible>
                <div id={consentId}>
                  <p>
                    <strong>{consent.headline}</strong>
                  </p>
                  {consent.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  <p>{consent.notNeeded}</p>
                </div>
              </KeptVisible>
              <p>
                <label className="oyl-announce__switch">
                  <input
                    type="checkbox"
                    checked={agreedHere}
                    disabled={busy}
                    aria-describedby={consentId}
                    onChange={(event) => {
                      void (event.target.checked
                        ? run(
                            () => port.agreeToHostedService(heldKey.origin),
                            () => ({ tone: 'success', text: HOSTED_AGREED }),
                          )
                        : run(
                            () => port.withdrawHostedAgreement(),
                            () => ({ tone: 'success', text: HOSTED_WITHDRAWN }),
                          ));
                    }}
                  />{' '}
                  {hostedAgreeLabel(heldKey.origin)}
                </label>
              </p>
              <p>{agreedHere ? HOSTED_AGREED_TEXT : consent.offUntilOn}</p>
              {agreedHere ? (
                <p>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      void test(heldKey.host, heldKey.reasoningTokens !== null);
                    }}
                  >
                    {HOSTED_TEST_BUTTON}
                  </Button>
                </p>
              ) : null}
            </>
          )}
        </>
      )}
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
    </section>
  );
}
