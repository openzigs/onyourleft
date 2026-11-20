// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838: the scores of an AI-pacer ride and its pass mark, over rides written
 * out by hand so that each number has one cause. `harness.test.ts` scores the
 * scripted ride ridden from answers the model gave.
 */

import type { PacerIntent } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  intentsCalledFor,
  PACER_PASS_MARK,
  pacerShortfalls,
  scorePacerRide,
  type PacerGround,
  type PacerScore,
  type PacerStep,
} from './pacer-score';

const ground = (change: Partial<PacerGround> = {}): PacerGround => ({
  riderPlace: 'level',
  gapTrend: 'steady',
  riderInDraft: false,
  terrain: 'none',
  ...change,
});

describe('what the gap calls for', () => {
  it.each<[string, Partial<PacerGround>, readonly PacerIntent[]]>([
    ['level', {}, ['hold']],
    ['in the draft, though behind', { riderPlace: 'behind', riderInDraft: true }, ['hold']],
    ['level before a climb', { terrain: 'before-climb' }, ['ease']],
    ['in the draft on a descent', { riderInDraft: true, terrain: 'descent' }, ['lift']],
    ['level over a top', { terrain: 'over-the-top' }, ['lift']],
    ['ahead and pulling away', { riderPlace: 'ahead', gapTrend: 'rider-gaining' }, ['lift']],
    ['ahead and steady', { riderPlace: 'ahead' }, ['hold', 'lift']],
    ['ahead and being caught', { riderPlace: 'ahead', gapTrend: 'rider-losing' }, ['hold', 'lift']],
    // The terrain rule never acts with the rider ahead, in the draft or not.
    [
      'ahead before a climb',
      { riderPlace: 'ahead', riderInDraft: true, terrain: 'before-climb' },
      ['hold', 'lift'],
    ],
    ['behind and losing ground', { riderPlace: 'behind', gapTrend: 'rider-losing' }, ['ease']],
    [
      'behind and coming back',
      { riderPlace: 'behind', gapTrend: 'rider-gaining' },
      ['hold', 'ease'],
    ],
    ['behind on the first ask', { riderPlace: 'behind', gapTrend: undefined }, ['hold', 'ease']],
    // Behind and out of the draft, the terrain is not the reason.
    ['behind on a descent', { riderPlace: 'behind', terrain: 'descent' }, ['hold', 'ease']],
    ['at a standstill', { riderPlace: undefined }, ['hold', 'lift', 'ease']],
  ])('with the rider %s', (_, change, called) => {
    expect(intentsCalledFor(ground(change))).toEqual(called);
  });
});

let asked = 0;
const step = (change: Partial<PacerStep> = {}): PacerStep => {
  asked += 5;
  return {
    askedAtS: asked,
    ground: ground(),
    outcome: 'applied',
    ridden: 'hold',
    line: 'none',
    ...change,
  };
};

describe('the scores of a ride', () => {
  it('counts the applied decisions that rode what the gap called for', () => {
    const score = scorePacerRide({
      steps: [
        step(),
        step({ ridden: 'ease' }),
        step({
          ground: ground({ riderPlace: 'behind', gapTrend: 'rider-losing' }),
          ridden: 'ease',
        }),
        // Not applied: neither for nor against.
        step({ outcome: 'late', ridden: undefined }),
        step({ outcome: 'invalid', ridden: undefined }),
        step({ outcome: 'failed', ridden: undefined }),
        step({ outcome: 'refused', ridden: undefined }),
      ],
      calls: [],
    });
    expect(score).toMatchObject({
      answers: 7,
      applied: 3,
      intentsCalledFor: 2,
      lateAnswers: 1,
      invalidAnswers: 1,
      failedAnswers: 2,
    });
  });

  it('counts an ease ridden with the rider ahead, and no other', () => {
    const ahead = ground({ riderPlace: 'ahead' });
    const score = scorePacerRide({
      steps: [
        step({ ground: ahead, ridden: 'ease' }),
        step({ ground: ahead, ridden: 'hold' }),
        step({ ground: ground({ riderPlace: 'behind' }), ridden: 'ease' }),
        step({ ground: ahead, outcome: 'late', ridden: undefined }),
      ],
      calls: [],
    });
    expect(score.easedWithRiderAhead).toBe(1);
  });

  it('counts the lines shown, the distinct ones and the repeats, case and marks aside', () => {
    const shown = (text: string): PacerStep => step({ line: 'shown', shown: text });
    const score = scorePacerRide({
      steps: [
        shown('Nice and steady.'),
        shown('nice and steady!'),
        shown('Nice  and steady'),
        shown('Spin a lighter gear.'),
        step({ line: 'voided', outcome: 'invalid', ridden: undefined }),
        step({ line: 'voided', outcome: 'invalid', ridden: undefined }),
        step({ line: 'hidden' }),
        step({ line: 'none' }),
      ],
      calls: [],
    });
    expect(score).toMatchObject({
      linesShown: 4,
      distinctLines: 2,
      repeatedLines: 2,
      linesVoided: 2,
      linesHidden: 1,
    });
  });

  it('times only the calls that gave an answer', () => {
    const score = scorePacerRide({
      steps: [],
      calls: [
        { text: 'a', latencyMs: 1_400, promptTokens: 1_500, outputTokens: 40 },
        { text: 'b', latencyMs: 1_600, promptTokens: 1_550, outputTokens: 44 },
        { text: undefined, latencyMs: 60_000 },
      ],
    });
    expect(score.answerMs).toEqual({ median: 1_400, p90: 1_600, most: 1_600 });
    expect(score.promptTokens.most).toBe(1_550);
    expect(score.outputTokens.median).toBe(40);
  });
});

describe('the pass mark for the ride', () => {
  /** A score at the mark exactly. */
  const AT_THE_MARK: PacerScore = {
    answers: 20,
    applied: 20,
    lateAnswers: 0,
    invalidAnswers: 0,
    failedAnswers: 0,
    intentsCalledFor: 16,
    easedWithRiderAhead: 0,
    linesShown: 10,
    distinctLines: 8,
    repeatedLines: 2,
    linesVoided: 1,
    linesHidden: 1,
    answerMs: { median: 0, p90: 0, most: 0 },
    promptTokens: { median: 0, p90: 0, most: 0 },
    outputTokens: { median: 0, p90: 0, most: 0 },
  };

  it('passes a ride at the mark', () => {
    expect(pacerShortfalls(AT_THE_MARK)).toEqual([]);
    expect(16 / 20).toBe(PACER_PASS_MARK.leastIntentShare);
  });

  it.each([
    ['intentShare', { intentsCalledFor: 15 }, { mark: 'intentShare', scored: 0.75, asked: 0.8 }],
    [
      'easedWithRiderAhead',
      { easedWithRiderAhead: 1 },
      { mark: 'easedWithRiderAhead', scored: 1, asked: 0 },
    ],
    [
      'distinctLineShare',
      { distinctLines: 7 },
      { mark: 'distinctLineShare', scored: 0.7, asked: 0.8 },
    ],
    ['voidedLineShare', { linesVoided: 2 }, { mark: 'voidedLineShare', scored: 0.15, asked: 0.1 }],
    ['voidedLineShare', { linesHidden: 2 }, { mark: 'voidedLineShare', scored: 0.15, asked: 0.1 }],
    [
      'appliedShare',
      { applied: 17, intentsCalledFor: 17, invalidAnswers: 3 },
      { mark: 'appliedShare', scored: 0.85, asked: 0.9 },
    ],
    ['lateAnswers', { lateAnswers: 1 }, { mark: 'lateAnswers', scored: 1, asked: 0 }],
  ] as const)('fails a ride under the mark on %s', (_, change, shortfall) => {
    expect(pacerShortfalls({ ...AT_THE_MARK, ...change })).toContainEqual(shortfall);
  });

  it('fails a ride that got no answer at all on every share', () => {
    const silent: PacerScore = {
      ...AT_THE_MARK,
      answers: 0,
      applied: 0,
      intentsCalledFor: 0,
      linesShown: 0,
      distinctLines: 0,
      repeatedLines: 0,
      linesVoided: 0,
      linesHidden: 0,
    };
    expect(pacerShortfalls(silent).map((short) => short.mark)).toEqual([
      'intentShare',
      'distinctLineShare',
      'appliedShare',
    ]);
  });
});
