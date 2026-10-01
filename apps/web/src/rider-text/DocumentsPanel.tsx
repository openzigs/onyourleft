// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Documents for the analysis** — the Settings panel where a rider adds a
 * training plan or a reference document, and the list they delete one from
 * (#836).
 *
 * A document is plain text or Markdown only (`document-file.ts` says what is
 * refused, and why), kept on this device first and synced (ADR 0040 D-1).
 * Removing one here removes it from this device, and the next sync removes it
 * from the instance — its passages and vectors in the same transaction (#835).
 *
 * The list is read from the store when the panel opens, and read again after
 * every add and remove — so what is shown is what is kept, never what was
 * asked for.
 */

import { useCallback, useEffect, useId, useState, type ChangeEvent, type JSX } from 'react';

import {
  MAXIMUM_DOCUMENT_CHARACTERS,
  MAXIMUM_RIDER_DOCUMENTS,
  type RiderTextRecord,
} from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { RIDER_TEXT_NO_STORE } from './RiderTextBox';
import { RiderTextDisclosure } from './RiderTextDisclosure';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_REFUSAL_TEXT,
  documentFileRefusal,
  readDocument,
} from './document-file';
import type { RiderTextPort } from './rider-text-port';

export const DOCUMENTS_HEADING = 'Documents for the analysis';

/** What a document may be, said before the picker. */
export const DOCUMENTS_LEAD = `A training plan or any reference you want the analysis to look back on: a plain text or Markdown file of up to ${MAXIMUM_DOCUMENT_CHARACTERS.toLocaleString('en-GB')} characters, and up to ${String(MAXIMUM_RIDER_DOCUMENTS)} of them.`;

export const DOCUMENT_ADD_LABEL = 'Add a document';

export const DOCUMENTS_EMPTY = 'No documents yet.';

export const DOCUMENTS_READING = 'Reading your documents…';

export const DOCUMENTS_NOT_READ = 'Your documents could not be read on this device.';

export const DOCUMENTS_FULL = `You have ${String(MAXIMUM_RIDER_DOCUMENTS)} documents, the most that can be kept. Remove one to add another.`;

/** Said once a document is added. The name is the rider's own file name. */
export function documentAdded(name: string): string {
  return `Added “${name}”.`;
}

/** Said once a document is removed. */
export function documentRemoved(name: string): string {
  return `Removed “${name}”. It is removed from your instance at the next sync.`;
}

/**
 * Asked before a document is removed (#924, the owner's ruling of 2026-09-30):
 * removing it here removes the instance's copy at the next sync, and the words
 * are the rider's own.
 */
export const DOCUMENT_REMOVE_QUESTION = 'Remove this document?';

/** The two answers to {@link DOCUMENT_REMOVE_QUESTION}. */
export const DOCUMENT_REMOVE_YES = 'Yes, remove it';
export const DOCUMENT_REMOVE_NO = 'Keep it';

/** Said when a chosen file could not be read (#920's review). Nothing changed. */
export const DOCUMENT_FILE_NOT_READ =
  'That file could not be read, so it was not added. Choose it again.';

/** Said when a write or a delete failed. Nothing changed. */
export function documentsFailure(reason: string): string {
  return `That could not be done, so your documents are as they were: ${reason}`;
}

/** A document's size, as the list shows it. */
export function documentSize(text: string): string {
  return `${text.length.toLocaleString('en-GB')} characters`;
}

type Message = { readonly tone: 'success' | 'warning' | 'danger'; readonly text: string };

export function DocumentsPanel({
  port,
}: {
  readonly port?: RiderTextPort | undefined;
}): JSX.Element {
  const [documents, setDocuments] = useState<readonly RiderTextRecord[] | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [message, setMessage] = useState<Message | undefined>(undefined);
  /** The document whose removal is being asked about (#924), or `undefined`. */
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  /** The document whose removal was just declined: its *Remove* takes focus back. */
  const [declined, setDeclined] = useState<string | undefined>(undefined);
  const inputId = useId();

  const reload = useCallback(async (): Promise<void> => {
    if (port === undefined) return;
    try {
      setDocuments(await port.store.listRiderTexts(port.athleteId, 'document'));
    } catch {
      setUnreadable(true);
    }
  }, [port]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // The same file chosen twice in a row fires `change` again only once the value is cleared.
    input.value = '';
    if (port === undefined || documents === undefined || file === undefined) return;
    if (documents.length >= MAXIMUM_RIDER_DOCUMENTS) {
      setMessage({ tone: 'warning', text: DOCUMENTS_FULL });
      return;
    }
    // Refused by its name and size before a byte is read.
    const early = documentFileRefusal(file.name, file.size);
    if (early !== undefined) {
      setMessage({ tone: 'warning', text: DOCUMENT_REFUSAL_TEXT[early] });
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      // The file changed or went away after it was chosen. Its error is not
      // repeated: it can name a path, and a path is not the rider's words.
      setMessage({ tone: 'danger', text: DOCUMENT_FILE_NOT_READ });
      return;
    }
    const reading = readDocument(file.name, bytes);
    if (reading.kind === 'refused') {
      setMessage({ tone: 'warning', text: DOCUMENT_REFUSAL_TEXT[reading.refusal] });
      return;
    }
    try {
      const kept = await port.store.putRiderText({
        athleteId: port.athleteId,
        kind: 'document',
        key: port.newDocumentId(),
        name: reading.name,
        text: reading.text,
        savedAt: port.now(),
      });
      setMessage({ tone: 'success', text: documentAdded(kept.name ?? reading.name) });
    } catch (error: unknown) {
      setMessage({
        tone: 'danger',
        text: documentsFailure(error instanceof Error ? error.message : String(error)),
      });
    }
    await reload();
  }

  async function remove(document: RiderTextRecord): Promise<void> {
    setConfirming(undefined);
    if (port === undefined) return;
    const name = document.name ?? '';
    try {
      await port.store.deleteRiderText(port.athleteId, 'document', document.key);
      setMessage({ tone: 'success', text: documentRemoved(name) });
    } catch (error: unknown) {
      setMessage({
        tone: 'danger',
        text: documentsFailure(error instanceof Error ? error.message : String(error)),
      });
    }
    await reload();
  }

  return (
    <section className="oyl-panel oyl-rider-text" aria-labelledby="oyl-documents-heading">
      <h3 id="oyl-documents-heading">{DOCUMENTS_HEADING}</h3>
      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {RIDER_TEXT_NO_STORE}
        </StatusMessage>
      ) : unreadable ? (
        <StatusMessage tone="danger">{DOCUMENTS_NOT_READ}</StatusMessage>
      ) : documents === undefined ? (
        <p className="oyl-muted">{DOCUMENTS_READING}</p>
      ) : (
        <>
          <p className="oyl-rider-text__form">
            <label htmlFor={inputId}>{DOCUMENT_ADD_LABEL}</label>
            <input
              id={inputId}
              className="oyl-input oyl-input--file"
              type="file"
              accept={DOCUMENT_ACCEPT}
              aria-describedby={`${inputId}-lead`}
              onChange={(event) => {
                void add(event);
              }}
            />
          </p>
          <p id={`${inputId}-lead`} className="oyl-muted">
            {DOCUMENTS_LEAD}
          </p>
          {documents.length === 0 ? (
            <p className="oyl-muted">{DOCUMENTS_EMPTY}</p>
          ) : (
            <ul className="oyl-rider-text__list">
              {documents.map((document) => (
                <li key={document.key}>
                  <span className="oyl-rider-text__name">
                    {document.name}{' '}
                    <span className="oyl-muted">({documentSize(document.text)})</span>
                  </span>{' '}
                  {confirming === document.key ? (
                    // The question REPLACES the Remove the rider pressed, so its
                    // safe answer takes focus (#557's rule): nothing is removed
                    // by a second press landing where the first one did.
                    <span
                      className="oyl-rider-text__confirm"
                      role="group"
                      aria-label={`${DOCUMENT_REMOVE_QUESTION} ${document.name ?? ''}`}
                    >
                      <span>{DOCUMENT_REMOVE_QUESTION}</span>{' '}
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void remove(document);
                        }}
                      >
                        {DOCUMENT_REMOVE_YES}
                        <span className="oyl-visually-hidden"> {document.name}</span>
                      </Button>{' '}
                      <Button
                        variant="secondary"
                        focusOnMount
                        onClick={() => {
                          setConfirming(undefined);
                          setDeclined(document.key);
                        }}
                      >
                        {DOCUMENT_REMOVE_NO}
                        <span className="oyl-visually-hidden"> {document.name}</span>
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      focusOnMount={declined === document.key}
                      onClick={() => {
                        setDeclined(undefined);
                        setConfirming(document.key);
                      }}
                    >
                      Remove<span className="oyl-visually-hidden"> {document.name}</span>
                    </Button>
                  )}
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
      <RiderTextDisclosure />
    </section>
  );
}
