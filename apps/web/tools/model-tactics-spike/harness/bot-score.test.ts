// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838: the scores of an AI-bot race and its pass mark, over races written
 * out by hand so that each number has one cause. `harness.test.ts` scores a
 * race ridden from answers the model gave.
 */

import type { BotTactic, ModelRacingStyle, ModelTacticsLogEntry } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  BOT_PASS_MARK,
  botRaceShortfalls,
  scoreBotRace,
  type BotRaceRun,
  type BotRaceSample,
  type BotRaceScore,
} from './bot-score';
import type { ModelCall } from './model-call';

const STYLES: readonly ModelRacingStyle[] = ['climber', 'sprinter', 'rouleur'];

/** One second: each bot's move, and optionally the grade ahead of each, who is blown and who leads. */
function second(
  tactics: readonly (BotTactic | null)[],
  more: Partial<Omit<BotRaceSample, 'tactics'>> = {},
): BotRaceSample {
  return {
    tactics,
    blown: more.blown ?? tactics.map(() => false),
    gradeAheadPct: more.gradeAheadPct ?? tactics.map(() => 0),
    leader: more.leader === undefined ? 0 : more.leader,
  };
}

function race(
  samples: readonly BotRaceSample[],
  more: {
    readonly log?: readonly ModelTacticsLogEntry[];
    readonly calls?: readonly ModelCall[];
  } = {},
): BotRaceRun {
  return {
    race: 'by-hand',
    hasClimb: false,
    styles: STYLES,
    samples,
    log: more.log ?? [FROM_THE_START],
    calls: more.calls ?? [],
  };
}

/** A decision in force from the first second, so that a race written by hand is scored whole. */
const FROM_THE_START: ModelTacticsLogEntry = {
  askedAtMs: -2_000,
  arrivedAtMs: -1,
  outcome: 'decision',
  moves: [],
};

const SIT: readonly BotTactic[] = ['sit-in', 'sit-in', 'sit-in'];

describe('the bots that made a move', () => {
  it('counts a bot that rode an attack, a flyer, a chase or a follow, once each', () => {
    const score = scoreBotRace(
      race([
        second(SIT),
        second(['attack', 'sit-in', 'sit-in']),
        second(['attack', 'follow', 'sit-in']),
        second(['flyer', 'chase', 'sit-in']),
      ]),
    );
    expect(score.bots).toBe(3);
    expect(score.seconds).toBe(4);
    expect(score.botsMoved).toBe(2);
  });

  it('does not count sitting in, recovering or the kick every finisher makes', () => {
    const score = scoreBotRace(
      race([second(SIT), second(['recover', 'kick', 'sit-in']), second(['kick', 'kick', 'kick'])]),
    );
    expect(score.botsMoved).toBe(0);
  });

  it('scores no move before the first decision arrives: the seeded start is not the model’s', () => {
    const arrivedAt = (arrivedAtMs: number): ModelTacticsLogEntry => ({
      askedAtMs: 4_000,
      arrivedAtMs,
      outcome: 'decision',
      moves: [],
    });
    const samples = [
      // Off the line, seeded: two bots follow, and the climber attacks on a climb.
      second(['attack', 'follow', 'follow'], { gradeAheadPct: [5, 0, 0] }),
      second(['attack', 'follow', 'sit-in'], { gradeAheadPct: [5, 0, 0] }),
      second(SIT),
      second(SIT),
      second(['sit-in', 'sit-in', 'chase']),
    ];
    const late = {
      askedAtMs: 0,
      arrivedAtMs: 1_000,
      outcome: 'late',
      reason: 'no-answer',
    } as const;
    const score = scoreBotRace(race(samples, { log: [late, arrivedAt(1_500)] }));
    expect(score.scoredFromS).toBe(2);
    expect(score.botsMoved).toBe(1);
    expect(score.attacksOnClimbsByClimbers).toBe(0);
    expect(score.longestQuietRunS).toBe(2);
    // A decision applies from the tactics window after it arrives, as in the race.
    expect(scoreBotRace(race(samples, { log: [arrivedAt(1_000)] })).scoredFromS).toBe(2);
    expect(scoreBotRace(race(samples, { log: [arrivedAt(999)] }))).toMatchObject({
      scoredFromS: 1,
      botsMoved: 3,
      attacksOnClimbsByClimbers: 1,
    });
    // With no decision at all there is no move to score.
    expect(scoreBotRace(race(samples, { log: [late] }))).toMatchObject({
      scoredFromS: 5,
      botsMoved: 0,
      longestQuietRunS: 0,
    });
  });

  it('counts apart the bots a decision told to move', () => {
    const log: ModelTacticsLogEntry[] = [
      {
        askedAtMs: 4_000,
        arrivedAtMs: 7_000,
        outcome: 'decision',
        moves: [
          { bot: 0, move: 'sit-in' },
          { bot: 1, move: 'kick' },
          { bot: 2, move: 'chase', target: 'rider' },
        ],
      },
      { askedAtMs: 11_000, arrivedAtMs: 20_000, outcome: 'late', reason: 'no-answer' },
    ];
    // Told one, and nobody rode a move: what was asked is not what was ridden.
    const score = scoreBotRace(race([second(SIT)], { log }));
    expect(score.botsToldToMove).toBe(1);
    expect(score.botsMoved).toBe(0);
  });
});

describe('attacks on climbs by climbers, and kicks by sprinters', () => {
  it('counts an attack once where it begins, by a climber, with a climb ahead', () => {
    const climb = { gradeAheadPct: [4, 4, 4] };
    const score = scoreBotRace(
      race([
        second(SIT, climb),
        // The climber (seat 0) and the rouleur (seat 2) attack on the climb.
        second(['attack', 'sit-in', 'attack'], climb),
        second(['attack', 'sit-in', 'attack'], climb),
        second(SIT, climb),
        second(['attack', 'sit-in', 'sit-in'], climb),
      ]),
    );
    expect(score.climbers).toBe(1);
    expect(score.attacksOnClimbsByClimbers).toBe(2);
  });

  it('does not count a climber’s attack with no climb ahead, and counts one at the bots’ own climb grade', () => {
    const flat = scoreBotRace(
      race([second(SIT), second(['attack', 'sit-in', 'sit-in'], { gradeAheadPct: [2.9, 0, 0] })]),
    );
    expect(flat.attacksOnClimbsByClimbers).toBe(0);
    const atTheGrade = scoreBotRace(
      race([second(SIT), second(['attack', 'sit-in', 'sit-in'], { gradeAheadPct: [3, 0, 0] })]),
    );
    expect(atTheGrade.attacksOnClimbsByClimbers).toBe(1);
  });

  it('counts the sprinters that kicked', () => {
    const none = scoreBotRace(race([second(['kick', 'sit-in', 'kick'])]));
    expect(none.sprinters).toBe(1);
    expect(none.sprintersKicked).toBe(0);
    expect(scoreBotRace(race([second(['sit-in', 'kick', 'sit-in'])])).sprintersKicked).toBe(1);
  });
});

describe('the longest quiet run', () => {
  it('is the most seconds in a row with nobody in a move or a kick', () => {
    const score = scoreBotRace(
      race([
        second(SIT),
        second(SIT),
        second(['sit-in', 'follow', 'sit-in']),
        second(SIT),
        second(['recover', 'sit-in', 'sit-in']),
        second(SIT),
        second(['sit-in', 'sit-in', 'kick']),
        second(SIT),
      ]),
    );
    expect(score.longestQuietRunS).toBe(3);
  });

  it('stops counting once every bot is over the line', () => {
    const score = scoreBotRace(
      race([
        second(SIT),
        second(['sit-in', null, null]),
        second([null, null, null], { leader: null }),
        second([null, null, null], { leader: null }),
        second([null, null, null], { leader: null }),
      ]),
    );
    expect(score.longestQuietRunS).toBe(2);
  });
});

describe('blown bots and lead changes', () => {
  it('counts each bot that blew once, and each time the lead changed hands', () => {
    const score = scoreBotRace(
      race([
        second(SIT, { leader: 0 }),
        second(SIT, { leader: 2, blown: [true, false, false] }),
        second(SIT, { leader: 2, blown: [true, false, true] }),
        second(SIT, { leader: 1, blown: [false, false, true] }),
        // Nobody racing reads as no leader, and is not a change.
        second([null, null, null], { leader: null }),
      ]),
    );
    expect(score.blownBots).toBe(2);
    expect(score.leadChanges).toBe(2);
  });
});

describe('the answers', () => {
  it('counts each outcome, and times only the calls that gave an answer', () => {
    const entry = (outcome: ModelTacticsLogEntry['outcome']): ModelTacticsLogEntry =>
      outcome === 'decision'
        ? { askedAtMs: 0, arrivedAtMs: 1, outcome, moves: [] }
        : { askedAtMs: 0, arrivedAtMs: 1, outcome, reason: 'no-answer' };
    const score = scoreBotRace(
      race([second(SIT)], {
        log: [
          entry('decision'),
          entry('decision'),
          entry('late'),
          entry('invalid'),
          entry('failed'),
          entry('refused'),
        ],
        calls: [
          { text: 'a', latencyMs: 3_000, promptTokens: 2_300, outputTokens: 70 },
          { text: 'b', latencyMs: 5_000, promptTokens: 2_400, outputTokens: 90 },
          { text: 'c', latencyMs: 9_000 },
          { text: undefined, latencyMs: 60_000 },
        ],
      }),
    );
    expect(score).toMatchObject({
      answers: 6,
      decisions: 2,
      lateAnswers: 1,
      invalidAnswers: 1,
      failedAnswers: 2,
      answerMs: { median: 5_000, p90: 9_000, most: 9_000 },
      promptTokens: { median: 2_300, p90: 2_400, most: 2_400 },
      outputTokens: { median: 70, p90: 90, most: 90 },
    });
  });
});

describe('the pass mark for a race', () => {
  /** A score at the mark exactly, on a circuit with a climb. */
  const AT_THE_MARK: BotRaceScore = {
    bots: 7,
    seconds: 240,
    scoredFromS: 7,
    botsMoved: BOT_PASS_MARK.leastBotsMoved,
    botsToldToMove: 0,
    climbers: 1,
    attacksOnClimbsByClimbers: BOT_PASS_MARK.leastClimberAttacksOnAClimb,
    sprinters: 2,
    sprintersKicked: 0,
    longestQuietRunS: BOT_PASS_MARK.mostQuietRunS,
    blownBots: 7,
    leadChanges: 0,
    answers: 10,
    decisions: 9,
    lateAnswers: 1,
    invalidAnswers: 0,
    failedAnswers: 0,
    answerMs: { median: 0, p90: 0, most: 0 },
    promptTokens: { median: 0, p90: 0, most: 0 },
    outputTokens: { median: 0, p90: 0, most: 0 },
  };

  it('passes a race at the mark', () => {
    expect(botRaceShortfalls(AT_THE_MARK, true)).toEqual([]);
  });

  it.each([
    ['botsMoved', { botsMoved: 4 }, { mark: 'botsMoved', scored: 4, asked: 5 }],
    [
      'longestQuietRunS',
      { longestQuietRunS: 31 },
      { mark: 'longestQuietRunS', scored: 31, asked: 30 },
    ],
    [
      'attacksOnClimbsByClimbers',
      { attacksOnClimbsByClimbers: 0 },
      { mark: 'attacksOnClimbsByClimbers', scored: 0, asked: 1 },
    ],
    [
      'decisionShare',
      { decisions: 8, invalidAnswers: 1 },
      { mark: 'decisionShare', scored: 0.8, asked: 0.9 },
    ],
    [
      'lateShare',
      { decisions: 9, lateAnswers: 2, answers: 11 },
      { mark: 'lateShare', scored: 2 / 11, asked: 0.1 },
    ],
  ] as const)('fails a race under the mark on %s', (_, change, shortfall) => {
    const short = botRaceShortfalls({ ...AT_THE_MARK, ...change }, true);
    expect(short).toContainEqual(shortfall);
  });

  it('asks for a climber’s attack only on a circuit with a climb, and only of a field with a climber', () => {
    const none = { ...AT_THE_MARK, attacksOnClimbsByClimbers: 0 };
    expect(botRaceShortfalls(none, false)).toEqual([]);
    expect(botRaceShortfalls({ ...none, climbers: 0 }, true)).toEqual([]);
  });

  it('fails a race that got no answer at all: the seeded race is not what was asked', () => {
    const silent = { ...AT_THE_MARK, answers: 0, decisions: 0, lateAnswers: 0 };
    expect(botRaceShortfalls(silent, false)).toEqual([
      { mark: 'decisionShare', scored: 0, asked: 0.9 },
    ]);
  });
});
