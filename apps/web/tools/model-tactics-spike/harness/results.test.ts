// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838: a results file holds numbers only. A line the model wrote, or any
 * other sentence, is refused before a file is written.
 */

import { describe, expect, it } from 'vitest';

import { assertNumbersOnly, resultFileName, resultFileText, type HarnessResult } from './results';

const RESULT: HarnessResult = {
  kind: 'pacer',
  promptVersion: 'pacer-5',
  model: 'gemma4:12b',
  measuredAt: '2026-11-19T02:45:22Z',
  passed: false,
  passMark: { leastIntentShare: 0.8 },
  shortfalls: [{ mark: 'intentShare', scored: 0.7333333333333333, asked: 0.8 }],
  score: {
    answers: 60,
    applied: 60,
    lateAnswers: 0,
    invalidAnswers: 0,
    failedAnswers: 0,
    intentsCalledFor: 44,
    easedWithRiderAhead: 0,
    linesShown: 59,
    linesWritten: 59,
    distinctLines: 48,
    repeatedLines: 11,
    linesHiddenRepeat: 0,
    linesHiddenAgainst: 1,
    linesVoided: 0,
    answerMs: { median: 1_448, p90: 1_600, most: 1_900 },
    promptTokens: { median: 1_548, p90: 1_552, most: 1_553 },
    outputTokens: { median: 43, p90: 48, most: 52 },
  },
};

describe('a results file', () => {
  it('is named for its kind, its prompt and when it was measured', () => {
    expect(resultFileName(RESULT)).toBe('pacer-pacer-5-20261119T024522Z.json');
  });

  it('is never named from a version that is not a single word', () => {
    expect(() => resultFileName({ ...RESULT, promptVersion: '../../pacer-5' })).toThrow(
      /^result\.promptVersion/u,
    );
  });

  it('is the result as JSON, read back whole', () => {
    expect(JSON.parse(resultFileText(RESULT))).toEqual(RESULT);
  });

  it.each([
    ['a line the model wrote', { ...RESULT, model: 'Nice and steady, stay on my wheel.' }],
    ['a sentence deep inside it', { ...RESULT, shortfalls: [{ mark: 'you are doing great' }] }],
    ['a word with a path in it', { ...RESULT, promptVersion: '../pacer-5' }],
    ['text longer than a word', { ...RESULT, model: 'm'.repeat(49) }],
    ['a number that is not finite', { ...RESULT, passMark: { leastIntentShare: Number.NaN } }],
  ])('refuses %s, and says where without saying what', (_, result) => {
    expect(() => resultFileText(result as HarnessResult)).toThrow(/^result/u);
    expect(() => resultFileText(result as HarnessResult)).not.toThrow(/steady|great|\.\.\//u);
  });

  it('takes numbers, booleans, null and single words at any depth', () => {
    expect(() => {
      assertNumbersOnly({ a: [1, true, null, 'flat-mid-lap'], b: { c: 'tactics-7' } });
    }).not.toThrow();
    expect(() => {
      assertNumbersOnly({ a: undefined });
    }).toThrow(/result\.a/u);
  });
});
