// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Words to mask** — the Settings panel for the rider's own list (#839).
 *
 * A street, a town, a family member's name: words no pattern can find. Every
 * entry is masked, whole-word and case-insensitive, in everything the AI
 * analysis sends to a hosted model (`ride-analysis/hosted-mask.ts`). The
 * rider's own computer is sent the full text.
 *
 * The list is read from the store when the panel opens and written whole on
 * every change, and each change is announced only after the store has
 * answered with the written row — never on its `undefined`, which means
 * nothing was written (`SettingsView.tsx` §`UNITS_NO_ATHLETE`'s reason).
 * Absent, not disabled, where there is no store to keep it in: the units'
 * and the weight's rule.
 */

import { useEffect, useId, useState, type JSX } from 'react';

import { parseMaskedWords } from '@onyourleft/store';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/KeptVisible';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import { addedMaskedWord, MASKED_WORD_REFUSAL_TEXT } from './masked-words';
import type { MaskedWordsPort } from './masked-words-port';

export const MASKED_WORDS_HEADING = 'Words to mask';

/** Where the list is used, and where it is kept. Kept visible (#666): it is about what leaves. */
export const MASKED_WORDS_LEAD =
  'Anything on this list is masked in everything the ride analysis sends to a hosted model. The list is kept with your rides on this device.';

/**
 * What masking cannot promise, and who is sent the text unmasked. Kept visible
 * (#1040, the owner's ruling of 2026-10-03): it is about what leaves, so it is
 * never behind the section's ⓘ, where #839 and #1031 had put it.
 */
export const MASKED_WORDS_CAVEAT =
  'Masking reduces what is sent; it does not guarantee that nothing personal gets through. Your own computer is sent the text in full.';

export const MASKED_WORDS_NO_STORE =
  'This browser has no local store, so a list made here would be forgotten as soon as the page reloaded.';

export const MASKED_WORDS_READING = 'Reading your list…';

export const MASKED_WORDS_EMPTY = 'Nothing is on your list yet.';

export const MASKED_WORD_ADD_LABEL = 'A word or phrase to mask';

export const MASKED_WORD_ADD_BUTTON = 'Add to the list';

export const MASKED_WORD_ADDED = 'Added. It is masked from the next request on.';

export const MASKED_WORD_REMOVED = 'Removed. It is no longer masked.';

/** Said when the list could not be read or written. */
export const MASKED_WORDS_NOT_READ =
  'Your list could not be read on this device. Nothing is sent to a hosted model until it can be.';

/** Said when a write failed. Nothing about the list changed. */
export function maskedWordsSaveFailure(reason: string): string {
  return `That could not be saved, so your list is as it was: ${reason}`;
}

/** Said when the store found no athlete row to write against. */
export const MASKED_WORDS_NO_ATHLETE =
  'there is no athlete row on this device to save it against, so nothing was written';

type Message = { readonly tone: 'success' | 'warning' | 'danger'; readonly text: string };

export function MaskedWordsPanel({
  port,
}: {
  readonly port?: MaskedWordsPort | undefined;
}): JSX.Element {
  const [words, setWords] = useState<readonly string[] | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState<Message | undefined>(undefined);
  const inputId = useId();

  useEffect(() => {
    if (port === undefined) {
      return undefined;
    }
    let current = true;
    port.store.getAthlete(port.athleteId).then(
      (row) => {
        if (current) {
          setWords(parseMaskedWords(row?.maskedWords));
        }
      },
      () => {
        if (current) {
          setUnreadable(true);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [port]);

  async function save(next: readonly string[], success: string): Promise<boolean> {
    if (port === undefined) {
      return false;
    }
    try {
      const saved = await port.store.setAthleteMaskedWords(port.athleteId, next);
      if (saved === undefined) {
        setMessage({ tone: 'danger', text: maskedWordsSaveFailure(MASKED_WORDS_NO_ATHLETE) });
        return false;
      }
      // What landed, not what was asked for: the store tidies the list.
      setWords(parseMaskedWords(saved.maskedWords));
      setMessage({ tone: 'success', text: success });
      return true;
    } catch (error: unknown) {
      setMessage({
        tone: 'danger',
        text: maskedWordsSaveFailure(error instanceof Error ? error.message : String(error)),
      });
      return false;
    }
  }

  async function add(): Promise<void> {
    if (words === undefined) {
      return;
    }
    const decision = addedMaskedWord(typed, words);
    if ('refusal' in decision) {
      setMessage({ tone: 'warning', text: MASKED_WORD_REFUSAL_TEXT[decision.refusal] });
      return;
    }
    if (await save(decision.words, MASKED_WORD_ADDED)) {
      setTyped('');
    }
  }

  return (
    <section className="oyl-panel oyl-masked-words" aria-labelledby="oyl-masked-words-heading">
      {/* #1031: what masking does is the section's help, behind its ⓘ, where a
        "More about words to mask" used to close the section. What it cannot
        promise, and what leaves unmasked, is kept above the form with the
        lead (#1040): never behind the ⓘ. */}
      <SectionHeading
        level={3}
        id="oyl-masked-words-heading"
        help={
          <>
            <p className="oyl-muted">
              Before anything is sent to a hosted model, e-mail addresses, phone numbers, links,
              street addresses, postcodes, coordinates and the names you gave your privacy zones are
              replaced with a placeholder such as [email] or [place], and so is everything on this
              list.
            </p>
            <p className="oyl-muted">
              A name is masked only if it is on this list: nothing can tell a person’s or a place’s
              name from any other word.
            </p>
          </>
        }
      >
        {MASKED_WORDS_HEADING}
      </SectionHeading>
      <KeptVisible>
        <p className="oyl-muted">{MASKED_WORDS_LEAD}</p>
        <p className="oyl-muted">{MASKED_WORDS_CAVEAT}</p>
      </KeptVisible>

      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {MASKED_WORDS_NO_STORE}
        </StatusMessage>
      ) : unreadable ? (
        <StatusMessage tone="danger">{MASKED_WORDS_NOT_READ}</StatusMessage>
      ) : words === undefined ? (
        <p className="oyl-muted">{MASKED_WORDS_READING}</p>
      ) : (
        <>
          <form
            className="oyl-trainer__form"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <p>
              <label htmlFor={inputId}>{MASKED_WORD_ADD_LABEL}</label>{' '}
              <input
                className="oyl-input"
                id={inputId}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setMessage(undefined);
                }}
              />
            </p>
            <Button variant="secondary" type="submit">
              {MASKED_WORD_ADD_BUTTON}
            </Button>
          </form>
          {words.length === 0 ? (
            <p className="oyl-muted">{MASKED_WORDS_EMPTY}</p>
          ) : (
            <ul className="oyl-masked-words__list">
              {words.map((word) => (
                <li key={word}>
                  <span className="oyl-masked-words__word">{word}</span>{' '}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void save(
                        words.filter((listed) => listed !== word),
                        MASKED_WORD_REMOVED,
                      );
                    }}
                  >
                    Remove<span className="oyl-visually-hidden"> {word}</span>
                  </Button>
                </li>
              ))}
            </ul>
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
