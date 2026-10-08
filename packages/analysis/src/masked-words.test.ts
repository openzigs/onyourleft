// SPDX-License-Identifier: Apache-2.0

/**
 * What a masked-word list may hold (#839) — the parser on its own. Moved here
 * from `packages/store`'s `activity-store.masked-words.test.ts` with the parser
 * (#1094); that file still holds the list's round trip through the store.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_MASKED_WORD_LENGTH,
  MAXIMUM_MASKED_WORDS,
  parseMaskedWords,
  tidyMaskedWord,
} from './masked-words';

describe('what a list may hold (#839)', () => {
  it('trims each entry, folds its inner white space, and drops blanks and repeats', () => {
    expect(
      parseMaskedWords(['  Acacia   Avenue ', '', '   ', 'acacia avenue', 'Priya', 'PRIYA']),
    ).toStrictEqual(['Acacia Avenue', 'Priya']);
    expect(tidyMaskedWord('\tOld\n Town ')).toBe('Old Town');
  });

  it('drops what is not a string, and reads anything that is not a list as an empty one', () => {
    expect(parseMaskedWords(['Priya', 7, null, {}, ['x']])).toStrictEqual(['Priya']);
    for (const stranger of [undefined, null, 'Priya', 7, {}]) {
      expect(parseMaskedWords(stranger), JSON.stringify(stranger)).toStrictEqual([]);
    }
  });

  it('drops an entry past the longest, and stops at the most entries', () => {
    const long = 'x'.repeat(MAXIMUM_MASKED_WORD_LENGTH + 1);
    expect(parseMaskedWords([long, 'y'.repeat(MAXIMUM_MASKED_WORD_LENGTH)])).toHaveLength(1);
    const many = Array.from({ length: MAXIMUM_MASKED_WORDS + 5 }, (_, index) => `w${index}`);
    expect(parseMaskedWords(many)).toHaveLength(MAXIMUM_MASKED_WORDS);
  });
});
