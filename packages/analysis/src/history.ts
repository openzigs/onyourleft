// SPDX-License-Identifier: Apache-2.0

/**
 * **The rider's history, as a template's history step takes it** — #835, ADR
 * 0040 D-2, D-8.
 *
 * The passages of a rider's history — earlier write-ups, ride summaries,
 * goals, notes and documents — that may reach a prompt. This module decides
 * what of an instance's answer may:
 *
 * - **Only the shape asked for.** At most the template's passage count and
 *   character budget; each passage a kind the instance may return, a label of
 *   this app's own spelling, and text of at most 900 characters. An answer
 *   that is anything else is not used at all.
 * - **A retrieved write-up is screened again** (ADR 0035 D-4, `write-up-screen.ts`):
 *   the device saved it screened, so one that fails now changed on the
 *   instance. It is dropped from this run, and the rider is not shown it.
 * - **The rider's own text is otherwise kept whole** (ADR 0040 D-2 item 3): a
 *   note or a document is theirs. It is DATA, and the template's history step
 *   fences it (`template-v2.ts` §`HISTORY_FENCE_BEGIN`).
 *
 * Only {@link acceptHistoryAnswer} makes a {@link HistoryPassage}, so a
 * template builder cannot be handed text that did not come through it.
 *
 * ⚠️ **Since #1103 nothing on the device asks for history**: the device's own
 * run, and the `instanceHistorySource` it was to be handed, went with the
 * device's write-up paths (ADR 0046 D-1). The instance's agent searches the
 * index itself (`apps/instance` §`analysis/tools/history-search.ts`).
 */

import { passedScreen, screenSavedWriteUp } from './screen/write-up-screen';

/** The kinds of passage the instance returns (the instance's `history/passages.ts` §`INDEXED_KINDS`). */
export const HISTORY_KINDS = ['write-up', 'ride-summary', 'goal', 'note', 'document'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** The longest one passage may be: the instance splits a longer one when it indexes it (D-8). */
export const MAXIMUM_PASSAGE_CHARACTERS = 900;

/** The longest a passage's label may be (D-2: about 40 characters beside each passage). */
export const MAXIMUM_LABEL_CHARACTERS = 40;

declare const accepted: unique symbol;

/** A passage of the rider's history, as {@link acceptHistoryAnswer} accepted it. */
export interface HistoryPassage {
  readonly kind: HistoryKind;
  /** What it is, and for a ride how long before or after this one: `Your note`, `Write-up of a ride 3 weeks earlier`. */
  readonly label: string;
  readonly text: string;
  readonly [accepted]: true;
}

/** A label as the instance spells one: words, digits, spaces and hyphens. */
const LABEL = /^[A-Za-z0-9 -]{1,40}$/;

/** A lone half of a surrogate pair: not well-formed text. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Every control character but a newline and a tab. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The passages of an instance's answer that may reach a prompt, or
 * `undefined` when the answer is not the shape asked for. @see the file comment.
 */
export function acceptHistoryAnswer(
  body: unknown,
  /** The most passages, and the most characters of passage text, the template has room for. */
  request: { readonly limit: number; readonly characters: number },
): readonly HistoryPassage[] | undefined {
  if (!isObject(body) || Object.keys(body).join() !== 'passages') {
    return undefined;
  }
  const { passages } = body;
  if (!Array.isArray(passages) || passages.length > request.limit) {
    return undefined;
  }
  const kept: HistoryPassage[] = [];
  let characters = 0;
  for (const passage of passages as unknown[]) {
    if (!isObject(passage) || Object.keys(passage).sort().join() !== 'kind,label,text') {
      return undefined;
    }
    const { kind, label, text } = passage;
    if (
      !HISTORY_KINDS.includes(kind as HistoryKind) ||
      typeof label !== 'string' ||
      !LABEL.test(label) ||
      typeof text !== 'string' ||
      text.trim() === '' ||
      text.length > MAXIMUM_PASSAGE_CHARACTERS ||
      LONE_SURROGATE.test(text)
    ) {
      return undefined;
    }
    characters += text.length;
    if (characters > request.characters) {
      return undefined;
    }
    // Screened again: a write-up that fails now changed on the instance (D-8).
    if (kind === 'write-up' && !passedScreen(screenSavedWriteUp(text))) {
      continue;
    }
    kept.push({
      kind: kind as HistoryKind,
      label,
      text: text.replace(CONTROL, ' ').trim(),
    } as HistoryPassage);
  }
  return kept;
}
