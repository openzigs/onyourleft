// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: **what one AI-bot race came to, and its pass
 * mark.** Pure: a ridden race in (`bot-races.ts` §`BotRaceRun`), numbers out.
 *
 * ## What is scored
 *
 * Read off the race **as it was ridden**, once a second, not off the model's
 * answers: a move the model asked for and the body refused did not happen,
 * and a move the seeded tactics made where the model had no opinion did.
 *
 * **The moves are scored from the second the first decision applies from**
 * (`@onyourleft/domain` §`modelTacticsAppliedAtMs`). Until then, some eight
 * seconds in, every bot rides its seeded start
 * whatever the model is told, and a bot that follows a wheel off the line
 * would be called a mover by a prompt that never moved it. A race with no
 * decision at all has no move to score.
 *
 * - **Bots that made a move** ({@link BOT_MOVES}): rode an attack, a flyer, a
 *   chase or a follow at least once. The kick is left out: every bot that
 *   reaches its launch kicks by instinct (ADR 0074), so counting it would
 *   call every finisher a mover. Beside it, and with no mark, the bots a
 *   decision **told** to move: the two differ wherever the race rides
 *   something the model did not ask for.
 * - **Attacks on climbs by climbers**: attacks begun by a `climber` with the
 *   road ahead at the bots' own climb grade or steeper.
 * - **Kicks by sprinters**: `sprinter`s that kicked.
 * - **The longest quiet run**: the most seconds in a row with a bot still
 *   racing and none of them in a move or a kick, "all sit-in".
 * - **Blown bots, and lead changes** among the bots.
 * - **The answers**: how many, how many were decisions, late, invalid or
 *   failed, the time each took and the tokens read and written.
 *
 * ## The pass mark, and why ({@link BOT_PASS_MARK})
 *
 * The owner's tablet race of 2026-11-18 (#2836) is what it is set against:
 * seven bots, 3 min 36 s, and "five of seven bots never move", with ten
 * answers in a row, 76 s, of every bot sitting in, and a climber that sat in
 * on the climb.
 *
 * - **At least 5 of 7 bots make a move** in each race. That race had 2. A
 *   race where most of the field never acts is the failure #2836 names, and
 *   5 leaves room for two wheel-sitters, which a real field has.
 * - **No quiet run over 30 s.** That race's was 76 s. Half a minute with
 *   nothing happening is long enough for a rider to see that nothing is.
 * - **On a circuit with a climb, a climber attacks on it at least once.**
 *   "It was odd the climber did not catch up on the climb."
 * - **At least 9 answers in 10 are decisions, and at most 1 in 10 is late.**
 *   Before #2759's fixes, 41 of 46 answers were late and the race rode
 *   seeded tactics; a prompt that makes the model slow or invalid fails
 *   here however good its moves are.
 *
 * Blown bots, lead changes and kicks by sprinters are reported and carry no
 * mark: nothing on record says what number of them is wrong.
 */

import {
  BOT_TACTIC_CLIMB_GRADE_PERCENT,
  modelTacticsAppliedAtMs,
  type BotTactic,
  type ModelRacingStyle,
  type ModelTacticsLogEntry,
} from '@onyourleft/domain';

import { spread, type ModelCall, type Spread } from './model-call';

/** One second of a ridden race, each array by the bot's seat. */
export interface BotRaceSample {
  /** The move each bot rode this second, or `null` once it is over the line. */
  readonly tactics: readonly (BotTactic | null)[];
  /** Whether each bot's W′ is exhausted. */
  readonly blown: readonly boolean[];
  /** The grade ahead of each bot, percent, as its tactics read it. */
  readonly gradeAheadPct: readonly number[];
  /** The seat of the leading bot still racing, or `null` with none. */
  readonly leader: number | null;
}

/** A race, ridden: what the scores are read off. */
export interface BotRaceRun {
  /** The race's name (`bot-races.ts` §`BOT_RACES`). */
  readonly race: string;
  /** Whether its circuit has a climb a climber should attack on. */
  readonly hasClimb: boolean;
  /** Each bot's racing style, by seat. */
  readonly styles: readonly ModelRacingStyle[];
  /** One sample a second of race time, from the first. */
  readonly samples: readonly BotRaceSample[];
  /** The race's own decision log. */
  readonly log: readonly ModelTacticsLogEntry[];
  /** Every model call made, in order. */
  readonly calls: readonly ModelCall[];
}

/** The moves that count as a bot acting: the kick is left out (see the file comment). */
export const BOT_MOVES: readonly BotTactic[] = ['attack', 'flyer', 'chase', 'follow'];

const MOVES: ReadonlySet<BotTactic | null> = new Set(BOT_MOVES);

/** What one race came to. Numbers only. */
export interface BotRaceScore {
  readonly bots: number;
  readonly seconds: number;
  /** The second the moves are scored from: where the first decision applies from, or the race's end with none. */
  readonly scoredFromS: number;
  readonly botsMoved: number;
  /** Bots a decision named a move for at least once: what the model asked, beside what was ridden. */
  readonly botsToldToMove: number;
  readonly climbers: number;
  readonly attacksOnClimbsByClimbers: number;
  readonly sprinters: number;
  readonly sprintersKicked: number;
  readonly longestQuietRunS: number;
  readonly blownBots: number;
  readonly leadChanges: number;
  readonly answers: number;
  readonly decisions: number;
  readonly lateAnswers: number;
  readonly invalidAnswers: number;
  readonly failedAnswers: number;
  /** How long an answer took, ms, over every call that gave one. */
  readonly answerMs: Spread;
  readonly promptTokens: Spread;
  readonly outputTokens: Spread;
}

const present = (values: readonly (number | undefined)[]): number[] =>
  values.filter((value): value is number => value !== undefined);

/** The scores of `run`. */
export function scoreBotRace(run: BotRaceRun): BotRaceScore {
  const { samples, styles, log, calls } = run;
  const seats = styles.map((_, seat) => seat);
  const first = log.find((entry) => entry.outcome === 'decision');
  const scoredFrom =
    first === undefined
      ? samples.length
      : Math.min(samples.length, modelTacticsAppliedAtMs(first.arrivedAtMs) / 1_000);
  const scored = samples.slice(scoredFrom);
  const rode = (seat: number, tactic: BotTactic): boolean =>
    scored.some((sample) => sample.tactics[seat] === tactic);
  let attacksOnClimbs = 0;
  let quiet = 0;
  let longestQuiet = 0;
  let leadChanges = 0;
  let leader: number | null = null;
  scored.forEach((sample, at) => {
    const before = scored[at - 1];
    for (const seat of seats) {
      if (
        styles[seat] === 'climber' &&
        sample.tactics[seat] === 'attack' &&
        before?.tactics[seat] !== 'attack' &&
        (sample.gradeAheadPct[seat] ?? 0) >= BOT_TACTIC_CLIMB_GRADE_PERCENT
      ) {
        attacksOnClimbs += 1;
      }
    }
    const racing = sample.tactics.some((tactic) => tactic !== null);
    const acting = sample.tactics.some((tactic) => MOVES.has(tactic) || tactic === 'kick');
    quiet = racing && !acting ? quiet + 1 : 0;
    longestQuiet = Math.max(longestQuiet, quiet);
  });
  // The lead and the bodies are the whole race's, its start included.
  for (const sample of samples) {
    if (sample.leader === null) continue;
    if (leader !== null && sample.leader !== leader) leadChanges += 1;
    leader = sample.leader;
  }
  const count = (outcome: ModelTacticsLogEntry['outcome']): number =>
    log.filter((entry) => entry.outcome === outcome).length;
  const answered = calls.filter((call) => call.text !== undefined);
  return {
    bots: styles.length,
    seconds: samples.length,
    scoredFromS: scoredFrom,
    botsMoved: seats.filter((seat) => BOT_MOVES.some((move) => rode(seat, move))).length,
    botsToldToMove: seats.filter((seat) =>
      log.some((entry) =>
        (entry.moves ?? []).some((move) => move.bot === seat && MOVES.has(move.move)),
      ),
    ).length,
    climbers: styles.filter((style) => style === 'climber').length,
    attacksOnClimbsByClimbers: attacksOnClimbs,
    sprinters: styles.filter((style) => style === 'sprinter').length,
    sprintersKicked: seats.filter((seat) => styles[seat] === 'sprinter' && rode(seat, 'kick'))
      .length,
    longestQuietRunS: longestQuiet,
    blownBots: seats.filter((seat) => samples.some((sample) => sample.blown[seat] === true)).length,
    leadChanges,
    answers: log.length,
    decisions: count('decision'),
    lateAnswers: count('late'),
    invalidAnswers: count('invalid'),
    failedAnswers: count('failed') + count('refused'),
    answerMs: spread(answered.map((call) => call.latencyMs)),
    promptTokens: spread(present(answered.map((call) => call.promptTokens))),
    outputTokens: spread(present(answered.map((call) => call.outputTokens))),
  };
}

/** The pass mark for one race. The reasons are in the file comment. */
export const BOT_PASS_MARK = {
  /** At least this many of a seven-bot field make a move. */
  leastBotsMoved: 5,
  /** No quiet run longer than this, seconds. */
  mostQuietRunS: 30,
  /** On a circuit with a climb, at least this many attacks on it by a climber. */
  leastClimberAttacksOnAClimb: 1,
  /** At least this share of answers are decisions. */
  leastDecisionShare: 0.9,
  /** At most this share of answers are late. */
  mostLateShare: 0.1,
} as const;

/** One mark a race fell under: which, what it scored, and what the mark asks. */
export interface Shortfall {
  readonly mark: string;
  readonly scored: number;
  readonly asked: number;
}

/**
 * Every mark `score` falls under, none for a pass. A race with no answers at
 * all fails the decision share: a harness that reached no model has scored
 * the seeded race, which is not what it was asked.
 */
export function botRaceShortfalls(score: BotRaceScore, hasClimb: boolean): readonly Shortfall[] {
  const short: Shortfall[] = [];
  const under = (mark: string, scored: number, asked: number): void => {
    if (scored < asked) short.push({ mark, scored, asked });
  };
  const over = (mark: string, scored: number, asked: number): void => {
    if (scored > asked) short.push({ mark, scored, asked });
  };
  under('botsMoved', score.botsMoved, BOT_PASS_MARK.leastBotsMoved);
  over('longestQuietRunS', score.longestQuietRunS, BOT_PASS_MARK.mostQuietRunS);
  if (hasClimb && score.climbers > 0) {
    under(
      'attacksOnClimbsByClimbers',
      score.attacksOnClimbsByClimbers,
      BOT_PASS_MARK.leastClimberAttacksOnAClimb,
    );
  }
  const share = (part: number): number => (score.answers === 0 ? 0 : part / score.answers);
  under('decisionShare', share(score.decisions), BOT_PASS_MARK.leastDecisionShare);
  over('lateShare', share(score.lateAnswers), BOT_PASS_MARK.mostLateShare);
  return short;
}
