// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a file a rider adds as a document may be — #836: **plain text or
 * Markdown only** in this version, decoded as UTF-8 and refused otherwise.
 *
 * Decided here, before anything is written, so each refusal is a sentence a
 * rider can act on rather than a store error. The store checks the same
 * length and control-character rules again on the way in
 * (`packages/store` §`rider-text.ts`).
 *
 * ## The four refusals that are about the FILE
 *
 * - **`not-text`** — its name ends in neither `.txt`, `.md` nor `.markdown`.
 *   A PDF, a Word file or a picture is refused by its name before a byte is
 *   read: a PDF would need a converter this app does not ship, and a picture
 *   is never stored (#799).
 * - **`not-utf8`** — the bytes are not UTF-8 (`TextDecoder` with `fatal`).
 *   Nothing is guessed: a file in another encoding would be stored as
 *   something the rider never wrote.
 * - **`binary`** — it decodes, but holds a control character other than a
 *   tab, a newline or a carriage return: what a binary file renamed `.txt`
 *   looks like.
 * - **`picture`** — it holds a `data:` URL, the way Markdown embeds an image.
 *   The instance would index none of it (`apps/instance/src/history/passages.ts`),
 *   so it is refused here, where the rider can take the image out.
 *
 * and three about its size: `empty`, `too-long` (over
 * `MAXIMUM_DOCUMENT_CHARACTERS`, in characters), and a name too long to keep
 * (`name-too-long`).
 */

import {
  MAXIMUM_DOCUMENT_CHARACTERS,
  MAXIMUM_DOCUMENT_NAME_CHARACTERS,
  tidyRiderText,
  withoutBidiControls,
} from '@onyourleft/store';

/** Why a file was not added. */
export type DocumentRefusal =
  'not-text' | 'not-utf8' | 'binary' | 'picture' | 'empty' | 'too-long' | 'name-too-long';

/** The extensions a document may have. */
export const DOCUMENT_EXTENSIONS: readonly string[] = ['.txt', '.md', '.markdown'];

/** What the file picker offers: the extensions and the two text types. */
export const DOCUMENT_ACCEPT = [...DOCUMENT_EXTENSIONS, 'text/plain', 'text/markdown'].join(',');

/** The largest file read at all, in bytes: every UTF-16 unit is at most three UTF-8 bytes. */
export const MAXIMUM_DOCUMENT_BYTES = MAXIMUM_DOCUMENT_CHARACTERS * 3;

/** One sentence per refusal. None repeats the file's contents; the name is the rider's own. */
export const DOCUMENT_REFUSAL_TEXT: Readonly<Record<DocumentRefusal, string>> = {
  'not-text':
    'Only a plain text or Markdown file can be added — a name ending in .txt, .md or .markdown. A PDF, a Word file or a picture cannot.',
  'not-utf8':
    'That file is not UTF-8 text, so it was not added. Save it as UTF-8 text and add it again.',
  binary: 'That file holds characters that are not text, so it was not added.',
  picture:
    'That file has a picture inside it, and pictures are never kept for the analysis. Take the picture out and add it again.',
  empty: 'That file has no text in it.',
  'too-long': `That file is longer than ${MAXIMUM_DOCUMENT_CHARACTERS.toLocaleString('en-GB')} characters. Split it into shorter files and add each.`,
  'name-too-long': `That file’s name is longer than ${String(MAXIMUM_DOCUMENT_NAME_CHARACTERS)} characters. Rename it and add it again.`,
};

/** A file's bytes, read as a document — or why not. */
export type DocumentReading =
  | { readonly kind: 'document'; readonly name: string; readonly text: string }
  | { readonly kind: 'refused'; readonly refusal: DocumentRefusal };

/**
 * A `data:` URL: a type, a slash, anything but a comma or a space, a comma.
 *
 * ⚠️ ONE quantifier after the slash, and it must stay one: `[a-z0-9.+-]*`
 * followed by `[^,\s]*` both match a letter, so a run with no comma was retried
 * at every split — quadratic, 6.7 s for 100 000 characters on the main thread
 * (#920's review). This pattern matches the same URLs in linear time.
 * `apps/instance/src/history/passages.ts` no longer has the old form: since
 * #918 it is §`holdsDataUrl`, a scan (#921, #924 item 7).
 */
const DATA_URL = /\bdata:[a-z0-9.+-]*\/[^,\s]*,/iu;

/** Every control character but a tab, a newline and a carriage return. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const NOT_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/** Whether a name has one of {@link DOCUMENT_EXTENSIONS}, compared case-insensitively. */
export function isDocumentName(name: string): boolean {
  const lower = name.toLowerCase();
  return DOCUMENT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Whether a file is worth reading at all: by its name and its size, before a byte is read. */
export function documentFileRefusal(chosenName: string, size: number): DocumentRefusal | undefined {
  // Judged as it will be kept: `plan.md\u202C` is a Markdown file.
  const name = withoutBidiControls(chosenName).trim();
  if (!isDocumentName(name)) return 'not-text';
  if (name.length > MAXIMUM_DOCUMENT_NAME_CHARACTERS) return 'name-too-long';
  if (size > MAXIMUM_DOCUMENT_BYTES) return 'too-long';
  return undefined;
}

/** A chosen file's name and bytes, read as a document. */
export function readDocument(chosenName: string, bytes: Uint8Array): DocumentReading {
  // A bidirectional override would make the name draw as another (#920's review).
  const name = withoutBidiControls(chosenName);
  const early = documentFileRefusal(name, bytes.byteLength);
  if (early !== undefined) return { kind: 'refused', refusal: early };
  let decoded: string;
  try {
    // `ignoreBOM: false` (the default) drops a leading byte order mark.
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { kind: 'refused', refusal: 'not-utf8' };
  }
  const text = tidyRiderText(decoded);
  // The length first, so no regular expression below ever runs over more than
  // MAXIMUM_DOCUMENT_CHARACTERS: the byte gate alone admits three times that.
  if (text.length > MAXIMUM_DOCUMENT_CHARACTERS) return { kind: 'refused', refusal: 'too-long' };
  if (NOT_TEXT.test(text)) return { kind: 'refused', refusal: 'binary' };
  if (DATA_URL.test(text)) return { kind: 'refused', refusal: 'picture' };
  if (text === '') return { kind: 'refused', refusal: 'empty' };
  return { kind: 'document', name: name.trim(), text };
}
