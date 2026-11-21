// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The write-up set's arithmetic (#2840), with no model: what counts as a
 * figure, when one is supported, when a turn passed the context, a ride's
 * score and the set's pass mark.
 */

import { MAXIMUM_SECTIONS } from '@onyourleft/analysis';
import { describe, expect, it } from 'vitest';

import { readRideInput } from '../src/analysis/job-input.ts';
import {
  figuresIn,
  overContext,
  scoreRide,
  SET_PASS_MARK,
  SET_READS,
  setShortfalls,
  supported,
  unsupportedCount,
  WRITE_UP_SET,
  type RideScore,
} from './write-up-set.ts';

describe('the set', () => {
  it('is twelve rides with names of their own, each one the instance would take', () => {
    expect(WRITE_UP_SET).toHaveLength(12);
    expect(new Set(WRITE_UP_SET.map((ride) => ride.name)).size).toBe(12);
    for (const ride of WRITE_UP_SET) {
      // Read as a job's input is read on its way out of the table.
      expect(readRideInput(JSON.parse(JSON.stringify(ride.input))).ok, ride.name).toBe(true);
    }
  });

  it('spans no sections to the most, a side-camera summary or none, and an unset weight', () => {
    const counts = WRITE_UP_SET.map((ride) => ride.input.sections.length);
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBe(MAXIMUM_SECTIONS);
    expect(WRITE_UP_SET.some((ride) => ride.input.pose !== undefined)).toBe(true);
    expect(WRITE_UP_SET.some((ride) => ride.input.rider.massKilograms === null)).toBe(true);
  });

  it('has a history to compare with: eight ride summaries, three goals and no workouts', async () => {
    expect(await SET_READS.listLiveSyncItems('anyone', 'ride-summary', 10)).toHaveLength(8);
    expect(await SET_READS.listLiveSyncItems('anyone', 'ride-summary', 3)).toHaveLength(3);
    expect(await SET_READS.listLiveSyncItems('anyone', 'goal', 20)).toHaveLength(3);
    expect(await SET_READS.listLiveSyncItems('anyone', 'workout', 40)).toHaveLength(0);
  });
});

describe('figures', () => {
  it('reads every figure as written', () => {
    expect(figuresIn('1,234.5 watts, -4.2 percent, and 88 rpm')).toStrictEqual([1234.5, -4.2, 88]);
    expect(figuresIn('no figures here')).toStrictEqual([]);
  });

  it('supports a figure given, rounded, as a percentage of a share, or a small count', () => {
    expect(supported(175, [175])).toBe(true);
    expect(supported(2.4, [2.43])).toBe(true);
    expect(supported(98, [0.98])).toBe(true);
    expect(supported(3, [])).toBe(true);
    // "about 200 watts" for 196.
    expect(supported(200, [196])).toBe(true);
  });

  it('does not support a figure nothing given is near', () => {
    expect(supported(245, [175, 0.98])).toBe(false);
    expect(supported(2.6, [2.43])).toBe(false);
    expect(supported(11, [])).toBe(false);
    expect(unsupportedCount('It was 245 watts and 175 watts over 3 sections.', [175])).toBe(1);
  });
});

describe('a turn past the context', () => {
  const turn = { promptTokens: 3_000, outputTokens: 900, maxOutputTokens: 1_024, milliseconds: 1 };

  it('is one whose prompt and allowance together pass it', () => {
    expect(overContext(turn, 4_096)).toBe(false);
    expect(overContext(turn, 4_023)).toBe(true);
    expect(overContext(turn, 4_024)).toBe(false);
  });

  it('cannot be told when the context or the prompt is not known', () => {
    expect(overContext(turn, undefined)).toBe(false);
    expect(overContext({ ...turn, promptTokens: undefined }, 1)).toBe(false);
  });
});

describe('a ride’s score', () => {
  it('counts turns, tokens, the turns past the context, words and unsupported figures', () => {
    const score = scoreRide({
      ride: 'r',
      outcome: 'written',
      turns: [
        { promptTokens: 1_200, outputTokens: 1_024, maxOutputTokens: 1_024, milliseconds: 20 },
        { promptTokens: 3_500, outputTokens: 700, maxOutputTokens: 4_096, milliseconds: 30 },
      ],
      tools: { goals: 1 },
      milliseconds: 55,
      writeUp: 'Power was 175 watts, not 999.',
      given: [175],
      contextTokens: 4_096,
    });
    expect(score).toStrictEqual<RideScore>({
      ride: 'r',
      outcome: 'written',
      turns: 2,
      tools: { goals: 1 },
      promptTokensByTurn: [1_200, 3_500],
      promptTokensMost: 3_500,
      promptTokensTotal: 4_700,
      outputTokensTotal: 1_724,
      turnsOverContext: 1,
      milliseconds: 55,
      words: 6,
      unsupportedFigures: 1,
    });
  });

  it('scores no words and no figures for a run that wrote nothing', () => {
    const score = scoreRide({
      ride: 'r',
      outcome: 'failed:out-of-context',
      turns: [],
      tools: {},
      milliseconds: 1,
      writeUp: undefined,
      given: [],
      contextTokens: undefined,
    });
    expect([score.words, score.unsupportedFigures, score.promptTokensMost]).toStrictEqual([
      0, 0, 0,
    ]);
  });
});

describe('the set’s pass mark', () => {
  const written = (over = 0, unsupported = 0): RideScore => ({
    ride: 'r',
    outcome: 'written',
    turns: 1,
    tools: {},
    promptTokensByTurn: [1],
    promptTokensMost: 1,
    promptTokensTotal: 1,
    outputTokensTotal: 1,
    turnsOverContext: over,
    milliseconds: 1,
    words: 100,
    unsupportedFigures: unsupported,
  });
  const twelve = (score: RideScore): RideScore[] => Array.from({ length: 12 }, () => score);

  it('passes a set wholly written, inside its context and true to its figures', () => {
    expect(setShortfalls(twelve(written()))).toStrictEqual([]);
  });

  it('fails on one turn past the context', () => {
    expect(setShortfalls([written(1), ...twelve(written()).slice(1)])).toStrictEqual([
      '1 turns passed the loaded context',
    ]);
  });

  it('fails below ten of twelve written, and passes at ten', () => {
    const failed = { ...written(), outcome: 'failed:out-of-time' };
    const ten = [...twelve(written()).slice(0, 10), failed, failed];
    expect(setShortfalls(ten)).toStrictEqual([]);
    expect(setShortfalls([...ten.slice(0, 9), failed, failed, failed])).toStrictEqual([
      `9 of 12 written`,
    ]);
    expect(SET_PASS_MARK.writtenAtLeast).toBe(10);
  });

  it('scales the written mark to a part of the set, and fails on many unsupported figures', () => {
    expect(setShortfalls([{ ...written(), outcome: 'withheld' }])).toStrictEqual([
      '0 of 1 written',
    ]);
    expect(setShortfalls([written(0, 2), written(0, 1)])).toStrictEqual([
      '3 unsupported figures in 2 write-ups',
    ]);
    expect(setShortfalls([written(0, 1), written(0, 1)])).toStrictEqual([]);
  });
});
