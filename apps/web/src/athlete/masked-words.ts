// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider may add to their list of words to mask (#839), decided before
 * it is written.
 *
 * The store tidies a list on its way in and drops what it cannot keep
 * (`@onyourleft/store` §`masked-words.ts`). ⚠️ **Dropping is the unsafe
 * direction for a privacy list** — a word the rider believes is masked and is
 * not — so this refuses those entries here, with a sentence, and the store's
 * drop is only ever reached by a row nobody typed.
 */

import {
  MAXIMUM_MASKED_WORD_LENGTH,
  MAXIMUM_MASKED_WORDS,
  tidyMaskedWord,
} from '@onyourleft/store';

/** Why an entry was not added. */
export type MaskedWordRefusal = 'empty' | 'one-character' | 'too-long' | 'listed' | 'full';

/** One sentence per refusal. None repeats what was typed: it is read aloud. */
export const MASKED_WORD_REFUSAL_TEXT: Readonly<Record<MaskedWordRefusal, string>> = {
  empty: 'Type a word or phrase to add.',
  'one-character':
    'A single letter or digit would mask it everywhere it appears, so enter at least two.',
  'too-long': `That is longer than ${String(MAXIMUM_MASKED_WORD_LENGTH)} characters. Add it in shorter parts.`,
  listed: 'That is on the list already.',
  full: `The list holds ${String(MAXIMUM_MASKED_WORDS)} entries. Remove one to add another.`,
};

/** The list with `typed` added, or why it cannot be. */
export function addedMaskedWord(
  typed: string,
  current: readonly string[],
): { readonly words: readonly string[] } | { readonly refusal: MaskedWordRefusal } {
  const word = tidyMaskedWord(typed);
  if (word === '') {
    return { refusal: 'empty' };
  }
  if ([...word].length < 2) {
    return { refusal: 'one-character' };
  }
  if (word.length > MAXIMUM_MASKED_WORD_LENGTH) {
    return { refusal: 'too-long' };
  }
  const key = word.toLocaleLowerCase('en');
  if (current.some((listed) => listed.toLocaleLowerCase('en') === key)) {
    return { refusal: 'listed' };
  }
  if (current.length >= MAXIMUM_MASKED_WORDS) {
    return { refusal: 'full' };
  }
  return { words: [...current, word] };
}
