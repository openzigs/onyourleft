// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a synced item is cut into** — the passages of ADR 0040 D-2 (#835).
 *
 * The instance holds, embeds and ranks text, and **interprets none of it**
 * (D-2, *Where the screen and the summary builder run*): the device built
 * every summary and screened every write-up before it synced them, and it
 * screens a write-up again when one comes back. So this file only finds the
 * text in a body and cuts it to size.
 *
 * | Kind | The text | |
 * |---|---|---|
 * | `write-up` | the synced write-up's `text` — the device's screened copy | D-2 row 1 |
 * | `ride-summary` | its `passages`, each built by the device from #809's input | D-2 row 2 |
 * | `goal`, `note`, `document` | a JSON body's `text`, or the body itself as plain text | D-2 rows 3–4 |
 * | `side-camera-report` | **never**: it carries the pose summary, which the index never holds | D-2 item 1 |
 * | `activity` | never: a file, not text | |
 *
 * ⚠️ **A body carrying a picture is not indexed at all** (D-2 item 1): a
 * `data:` URL anywhere in it — an image pasted into a document, say — makes
 * the whole item `picture`, and no passage of it is kept. The rider's own
 * text is otherwise not filtered (D-2 item 3).
 *
 * A passage is at most {@link MAXIMUM_PASSAGE_CHARACTERS}: a longer block is
 * SPLIT here, at a paragraph, a sentence or a space, and never cut when it is
 * returned (D-8).
 */

import type { SyncKind } from '../store/sql-store.ts';

/** The kinds the index is cut from, and no other (ADR 0040 D-2). */
export const INDEXED_KINDS: readonly SyncKind[] = [
  'write-up',
  'ride-summary',
  'goal',
  'note',
  'document',
];

/** The kinds a passage is about a ride of, whose key is that ride's activity id. */
export const RIDE_KINDS: readonly SyncKind[] = ['write-up', 'ride-summary'];

/** The longest one passage may be, in UTF-16 code units — `String.length` (ADR 0040 D-8). */
export const MAXIMUM_PASSAGE_CHARACTERS = 900;

/**
 * The most passages one item is cut into: 256, about 230 000 characters. A
 * document longer than that is not indexed (`too-long`) rather than indexed
 * in part, and the rider can split it.
 */
export const MAXIMUM_PASSAGES_PER_SOURCE = 256;

/** What an item was cut into, or why nothing. */
export type Cut =
  | { readonly kind: 'passages'; readonly passages: readonly string[] }
  | { readonly kind: 'empty' | 'picture' | 'too-long' };

/** A `data:` URL of any kind: a picture, or bytes pretending to be text. */
const DATA_URL = /\bdata:[a-z0-9.+-]*\/[a-z0-9.+-]*[^,\s]*,/i;

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The blocks of text a body holds, by kind; `[]` when it holds none. */
function blocksOf(kind: SyncKind, text: string): readonly string[] {
  const parsed = jsonOf(text);
  switch (kind) {
    case 'write-up':
      return isObject(parsed) && typeof parsed.text === 'string' ? [parsed.text] : [];
    case 'ride-summary':
      return isObject(parsed) && Array.isArray(parsed.passages)
        ? parsed.passages.filter((block): block is string => typeof block === 'string')
        : [];
    case 'goal':
    case 'note':
    case 'document':
      if (isObject(parsed)) return typeof parsed.text === 'string' ? [parsed.text] : [];
      return [text];
    default:
      return [];
  }
}

/** Where `text` may be broken at or before `limit`: a paragraph, a sentence, a space, or anywhere. */
function breakAt(text: string, limit: number): number {
  const window = text.slice(0, limit + 1);
  for (const pattern of [/\n\s*\n/g, /[.!?]["')\]]?\s/g, /\s/g]) {
    let best = -1;
    for (const match of window.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (end <= limit && end > 0) best = end;
    }
    if (best > 0) return best;
  }
  return limit;
}

/** One block, cut into passages of at most {@link MAXIMUM_PASSAGE_CHARACTERS}. */
export function splitBlock(block: string): readonly string[] {
  const passages: string[] = [];
  let rest = block.replace(/\r\n?/g, '\n').trim();
  while (rest.length > MAXIMUM_PASSAGE_CHARACTERS) {
    let at = breakAt(rest, MAXIMUM_PASSAGE_CHARACTERS);
    // Never split a surrogate pair.
    const code = rest.charCodeAt(at - 1);
    if (code >= 0xd800 && code <= 0xdbff) at -= 1;
    const passage = rest.slice(0, at).trim();
    if (passage !== '') passages.push(passage);
    rest = rest.slice(at).trim();
  }
  if (rest !== '') passages.push(rest);
  return passages;
}

/** An item's body, cut into passages — or why it yields none. @see the file comment. */
export function cutSource(kind: SyncKind, body: Uint8Array): Cut {
  if (!INDEXED_KINDS.includes(kind)) return { kind: 'empty' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return { kind: 'empty' };
  }
  if (DATA_URL.test(text)) return { kind: 'picture' };
  const passages = blocksOf(kind, text).flatMap(splitBlock);
  if (passages.length === 0) return { kind: 'empty' };
  if (passages.length > MAXIMUM_PASSAGES_PER_SOURCE) return { kind: 'too-long' };
  return { kind: 'passages', passages };
}
