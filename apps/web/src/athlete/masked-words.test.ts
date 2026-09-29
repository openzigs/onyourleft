// SPDX-License-Identifier: AGPL-3.0-or-later

import { MAXIMUM_MASKED_WORD_LENGTH, MAXIMUM_MASKED_WORDS } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { addedMaskedWord, MASKED_WORD_REFUSAL_TEXT } from './masked-words';

describe('adding a word to mask (#839)', () => {
  it('adds a tidied entry at the end', () => {
    expect(addedMaskedWord('  Acacia   Avenue ', ['Priya'])).toStrictEqual({
      words: ['Priya', 'Acacia Avenue'],
    });
  });

  it.each([
    ['', [], 'empty'],
    ['   ', [], 'empty'],
    ['a', [], 'one-character'],
    [' 7 ', [], 'one-character'],
    ['x'.repeat(MAXIMUM_MASKED_WORD_LENGTH + 1), [], 'too-long'],
    ['PRIYA', ['Priya'], 'listed'],
    ['Zed', Array.from({ length: MAXIMUM_MASKED_WORDS }, (_, i) => `w${String(i)}`), 'full'],
  ] as const)('refuses %j', (typed, current, refusal) => {
    expect(addedMaskedWord(typed, current)).toStrictEqual({ refusal });
  });

  it('accepts two characters, and the longest entry', () => {
    expect(addedMaskedWord('Jo', [])).toStrictEqual({ words: ['Jo'] });
    const longest = 'y'.repeat(MAXIMUM_MASKED_WORD_LENGTH);
    expect(addedMaskedWord(longest, [])).toStrictEqual({ words: [longest] });
  });

  it('never repeats what was typed in a refusal', () => {
    for (const text of Object.values(MASKED_WORD_REFUSAL_TEXT)) {
      expect(text).not.toContain('Priya');
    }
  });
});
