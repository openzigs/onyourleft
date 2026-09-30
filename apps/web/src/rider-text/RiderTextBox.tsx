// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One box of the rider's own text for the analysis (#836): the goals on the
 * Settings screen, or a ride's note on its page. Both are the same control —
 * a labelled text area, how many characters it holds against its limit,
 * *Save*, and ADR 0040 D-11's disclosure under it — so they are one
 * component.
 *
 * The saved text is read from the store when the box opens and every save
 * shows what the store answered it wrote (`save.ts`). ⚠️ **Absent, not
 * disabled, where there is no store to keep it in**: the units' and the
 * weight's rule — the control's place is taken by the sentence saying why.
 */

import { useEffect, useId, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { RiderTextDisclosure } from './RiderTextDisclosure';
import type { RiderTextPort } from './rider-text-port';
import { riderTextLength, saveRiderText } from './save';

/** The words one box uses. */
export interface RiderTextBoxWords {
  readonly heading: string;
  readonly label: string;
  /** Said once the text is saved. */
  readonly saved: string;
  /** Said once the box was emptied and saved. */
  readonly cleared: string;
  /** The Save button's name — distinct per box, so a page with two is unambiguous. */
  readonly save: string;
}

/** Said where there is no store to keep the text in. */
export const RIDER_TEXT_NO_STORE =
  'This browser has no local store, so anything written here would be forgotten as soon as the page reloaded.';

/** Said while the saved text is being read. */
export const RIDER_TEXT_READING = 'Reading what you saved…';

/** Said when the saved text could not be read. Nothing is offered to overwrite it. */
export const RIDER_TEXT_NOT_READ = 'What you saved here could not be read on this device.';

/** How much of its limit a box holds, in the characters the limit is stated in. */
export function riderTextCount(length: number, maximum: number): string {
  return `${length.toLocaleString('en-GB')} of ${maximum.toLocaleString('en-GB')} characters.`;
}

/** Said when what was typed is over the limit: nothing is written. */
export function riderTextTooLong(maximum: number): string {
  return `That is longer than ${maximum.toLocaleString('en-GB')} characters, so it was not saved. Shorten it and save again.`;
}

/** Said when a write failed. What was saved before is unchanged. */
export function riderTextSaveFailure(reason: string): string {
  return `That could not be saved, so what you saved before is unchanged: ${reason}`;
}

type Message = { readonly tone: 'success' | 'warning' | 'danger'; readonly text: string };

export function RiderTextBox({
  port,
  kind,
  textKey,
  maximum,
  words,
  headingLevel,
}: {
  readonly port?: RiderTextPort | undefined;
  readonly kind: 'goal' | 'note';
  /** `goals` for the goals; the ride's id for a note. */
  readonly textKey: string;
  readonly maximum: number;
  readonly words: RiderTextBoxWords;
  readonly headingLevel: 2 | 3;
}): JSX.Element {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [message, setMessage] = useState<Message | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const headingId = `${id}-heading`;
  const countId = `${id}-count`;

  useEffect(() => {
    if (port === undefined) return undefined;
    let current = true;
    port.store.getRiderText(port.athleteId, kind, textKey).then(
      (row) => {
        if (current) setTyped(row?.text ?? '');
      },
      () => {
        if (current) setUnreadable(true);
      },
    );
    return () => {
      current = false;
    };
  }, [port, kind, textKey]);

  async function save(): Promise<void> {
    if (port === undefined || typed === undefined || saving) return;
    setSaving(true);
    const outcome = await saveRiderText(port, kind, textKey, typed);
    setSaving(false);
    switch (outcome.kind) {
      case 'saved':
        setTyped(outcome.record.text);
        setMessage({ tone: 'success', text: words.saved });
        return;
      case 'cleared':
        setTyped('');
        setMessage({ tone: 'success', text: words.cleared });
        return;
      case 'too-long':
        setMessage({ tone: 'warning', text: riderTextTooLong(outcome.maximum) });
        return;
      case 'failed':
        setMessage({ tone: 'danger', text: riderTextSaveFailure(outcome.reason) });
        return;
    }
  }

  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const length = typed === undefined ? 0 : riderTextLength(typed);

  return (
    <section
      className={headingLevel === 2 ? 'oyl-panel oyl-rider-text' : 'oyl-rider-text'}
      aria-labelledby={headingId}
    >
      <Heading id={headingId}>{words.heading}</Heading>
      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {RIDER_TEXT_NO_STORE}
        </StatusMessage>
      ) : unreadable ? (
        <StatusMessage tone="danger">{RIDER_TEXT_NOT_READ}</StatusMessage>
      ) : typed === undefined ? (
        <p className="oyl-muted">{RIDER_TEXT_READING}</p>
      ) : (
        <form
          className="oyl-rider-text__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={id}>{words.label}</label>
          <textarea
            id={id}
            className="oyl-input oyl-rider-text__box"
            rows={kind === 'goal' ? 6 : 4}
            value={typed}
            aria-describedby={countId}
            onChange={(event) => {
              setTyped(event.target.value);
              setMessage(undefined);
            }}
          />
          <p id={countId} className="oyl-muted">
            {riderTextCount(length, maximum)}
          </p>
          <Button variant="secondary" type="submit">
            {words.save}
          </Button>
        </form>
      )}
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
      <RiderTextDisclosure />
    </section>
  );
}
