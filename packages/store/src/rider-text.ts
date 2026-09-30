// SPDX-License-Identifier: Apache-2.0

/**
 * The rules for what a rider writes or adds for the analysis agent's history —
 * [#836](https://github.com/openzigs/onyourleft/issues/836), ADR 0040 D-1, D-2
 * and D-8. `records.ts` §`RiderTextRecord` is the record.
 *
 * ## The limits are in characters, and they come from the passage size
 *
 * The rider's instance cuts every synced text into passages of at most 900
 * characters (`apps/instance/src/history/passages.ts`), and a write-up is
 * sent at most six of them (ADR 0040 D-8). So:
 *
 * | Kind | Limit | Why |
 * |---|---|---|
 * | note | {@link MAXIMUM_RIDE_NOTE_CHARACTERS}, 900 | one passage, whole (#836) |
 * | goals | {@link MAXIMUM_GOALS_CHARACTERS}, 4 000 | "a short field"; at most five passages |
 * | document | {@link MAXIMUM_DOCUMENT_CHARACTERS}, 100 000 | about 112 passages: a full re-embed is about 20 s at the one measured CPU-only rate of 6 passages a second (#836's research) |
 *
 * A character is a UTF-16 code unit — `String.length` — which is how the
 * instance counts a passage. A document of 100 000 characters is also well
 * inside the instance's 1 MiB request body and its 256-passage cap.
 *
 * ## What text may hold
 *
 * No control character but a tab and a newline: a carriage return is folded
 * to a newline by {@link tidyRiderText} before anything is checked, so a file
 * written on Windows is kept rather than refused. A NUL is what a binary file
 * decoded by mistake looks like, and is refused with the rest.
 *
 * ⚠️ **Every message names the field and the constraint and never the value**
 * — free text can name anything (ADR 0004 decision D's rule, applied to it).
 */

/** The longest ride note, in UTF-16 code units: one 900-character passage (#836). */
export const MAXIMUM_RIDE_NOTE_CHARACTERS = 900;

/** The longest goals text, in UTF-16 code units: "a short field", at most five passages. */
export const MAXIMUM_GOALS_CHARACTERS = 4_000;

/** The longest document, in UTF-16 code units: about 112 passages, about 20 s to re-embed. */
export const MAXIMUM_DOCUMENT_CHARACTERS = 100_000;

/** The longest document name kept. A file name, not prose. */
export const MAXIMUM_DOCUMENT_NAME_CHARACTERS = 200;

/** The most documents one rider may keep: 50 × 100 000 characters is about 5 million. */
export const MAXIMUM_RIDER_DOCUMENTS = 50;

/** The one key the goals are kept under — one goals text per rider. */
export const GOALS_KEY = 'goals';

/** A document's id: what `crypto.randomUUID` makes, and nothing that could be a path. */
const DOCUMENT_KEY = /^[A-Za-z0-9-]{1,64}$/;

/** The longest ride id a note may name — ids here are UUIDs and slugs. */
const MAXIMUM_NOTE_KEY = 200;

/** Every control character but a tab and a newline: C0, DEL and C1. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_BUT_TAB_AND_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

/** The longest text of a kind, in UTF-16 code units. */
export function maximumRiderTextCharacters(kind: 'goal' | 'note' | 'document'): number {
  switch (kind) {
    case 'goal':
      return MAXIMUM_GOALS_CHARACTERS;
    case 'note':
      return MAXIMUM_RIDE_NOTE_CHARACTERS;
    case 'document':
      return MAXIMUM_DOCUMENT_CHARACTERS;
  }
}

/**
 * Text as it is kept: every carriage return folded to a newline (`\r\n` and a
 * lone `\r` alike), and the white space at either end removed. Nothing inside
 * is changed.
 */
export function tidyRiderText(text: string): string {
  return text.replace(/\r\n?/gu, '\n').trim();
}

/**
 * Why a rider text is not one, or `undefined` — for the write and for a row
 * read off disk alike, so a hand-edited row is refused on the way out exactly
 * as a bad one is on the way in.
 */
export function riderTextProblem(row: {
  readonly athleteId: unknown;
  readonly kind: unknown;
  readonly key: unknown;
  readonly name?: unknown;
  readonly text: unknown;
}): string | undefined {
  if (typeof row.athleteId !== 'string' || row.athleteId.length === 0) {
    return 'riderText.athleteId: must be an athlete id';
  }
  const kind = row.kind;
  if (kind !== 'goal' && kind !== 'note' && kind !== 'document') {
    return 'riderText.kind: must be goal, note or document';
  }
  const key = row.key;
  if (kind === 'goal' && key !== GOALS_KEY) {
    return `riderText.key: must be ${GOALS_KEY} for the goals`;
  }
  if (
    kind === 'note' &&
    (typeof key !== 'string' || key.length === 0 || key.length > MAXIMUM_NOTE_KEY)
  ) {
    return `riderText.key: must be an activity id of at most ${String(MAXIMUM_NOTE_KEY)} characters for a note`;
  }
  if (kind === 'document' && (typeof key !== 'string' || !DOCUMENT_KEY.test(key))) {
    return 'riderText.key: must be at most 64 letters, digits or hyphens for a document';
  }
  if (kind === 'document') {
    const name = row.name;
    if (
      typeof name !== 'string' ||
      name.trim().length === 0 ||
      name.length > MAXIMUM_DOCUMENT_NAME_CHARACTERS ||
      CONTROL_BUT_TAB_AND_NEWLINE.test(name) ||
      name.includes('\n') ||
      name.includes('\t')
    ) {
      return `riderText.name: must be a name of at most ${String(MAXIMUM_DOCUMENT_NAME_CHARACTERS)} characters on one line`;
    }
  } else if (row.name !== undefined) {
    return 'riderText.name: only a document has a name';
  }
  const text = row.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return 'riderText.text: must be text';
  }
  const maximum = maximumRiderTextCharacters(kind);
  if (text.length > maximum) {
    return `riderText.text: must be at most ${String(maximum)} characters`;
  }
  if (CONTROL_BUT_TAB_AND_NEWLINE.test(text)) {
    return 'riderText.text: must hold no control character but a tab or a newline';
  }
  return undefined;
}
