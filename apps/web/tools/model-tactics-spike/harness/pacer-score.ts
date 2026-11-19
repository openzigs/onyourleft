// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: **what one AI-pacer ride came to, and its pass
 * mark.** Pure: a ridden script in (`pacer-ride.ts` §`PacerRun`), numbers out.
 *
 * ## What is scored
 *
 * Since #2835 (ADR 0083) **the device decides the intent** (`@onyourleft/domain`
 * §`pacerRuleDecision`) on every ask, and the model writes only the line. So
 * the intent is scored as the device rode it, and the model is scored on its
 * line.
 *
 * - **The intent ridden against what the gap called for**
 *   ({@link intentsCalledFor}): of every decision, the share whose intent,
 *   as the device rode it, is one the rider's place called for. Every ask is
 *   a decision ridden, whatever became of its line.
 * - **Easing with the rider ahead**: decisions ridden as `ease` with the
 *   rider ahead of the pacer, counted on their own because no gap calls for
 *   it.
 * - **The lines**: how many were shown; of every line the model wrote in time
 *   that went with the intent (shown, or hidden as a repeat), how many were
 *   distinct and how many repeated an earlier one word for word; how many the
 *   device hid for saying one of its last lines again (`repeat`) or the
 *   opposite of what the pacer was doing (`against`); and how many answers
 *   were void: a key the answer may not carry (a plan, an intent, a power)
 *   or a line the screen stops (§`pacerSayProblem`).
 * - **The answers**: how many, how many applied, late, invalid or failed, the
 *   time each took and the tokens read and written.
 *
 * ## What the gap calls for
 *
 * The harness's own statement of it, in one place, from what each ask was
 * built with. It is the table the pacer's prompt has carried since `pacer-4`
 * (#2777), with ADR 0082's terrain rule:
 *
 * | The rider is | The gap is | Called for |
 * |---|---|---|
 * | level, or in the draft | (before a climb) | `ease` |
 * | level, or in the draft | (on a descent, or over a top) | `lift` |
 * | level, or in the draft | (elsewhere) | `hold` |
 * | ahead | opening: the rider pulling away | `lift` |
 * | ahead | otherwise | `hold` or `lift` |
 * | behind | opening: the rider losing ground | `ease` |
 * | behind | otherwise | `hold` or `ease` |
 *
 * An ask with no place to read (a rider at a standstill) calls for anything.
 *
 * ## The pass mark, and why ({@link PACER_PASS_MARK})
 *
 * - **At least 8 in 10 decisions ride an intent the gap called for.**
 *   Since #2835 the device's rule rides them, so this holds the rule to the
 *   table, as it held the model before. The owner's ride of 2026-11-18 (#2835): "saying it is slowing down
 *   when behind me", and 2.5 minutes of `ease`. On the scripted ride of
 *   #2762, the model chose `ease` on 46 of 48 asks whatever the gap was. 8 in
 *   10 leaves room for the asks where the gap is turning and two readings
 *   are fair.
 * - **Never eased with the rider ahead.** "It says it will push yet I am
 *   ahead and never see it taking over" (#2777). ADR 0078's floor stops it
 *   once the rider has been ahead for ten seconds, and the script holds them
 *   ahead for a minute; since #2835 the device's rule has no `ease` for a
 *   rider ahead at all, so a count above nought is the rule failing.
 * - **At least 8 in 10 lines written are distinct.** The owner's "did not
 *   vary much" (#2760): `pacer-1` said 18 distinct lines in 48, `pacer-2` 46.
 *   A repeat the device hides still counts against it: the model said it.
 * - **At most 1 answer in 10 is void or has its line hidden as against the
 *   intent.** Since #2835 either costs a line, not the pacing, but a prompt
 *   that draws them often is a pacer that stops talking.
 * - **At least 9 answers in 10 are applied, and none is late.** Every
 *   measured run on the owner's PC had 48 of 48 valid and none past the 5 s
 *   limit at 1.2 to 1.8 s a call.
 */

import {
  pacerTerrainApplies,
  type PacerDecisionOutcome,
  type PacerGapTrend,
  type PacerIntent,
  type PacerReason,
  type PacerTerrain,
  type RiderPlace,
} from '@onyourleft/domain';

import { spread, type ModelCall, type Spread } from './model-call';
import type { Shortfall } from './bot-score';

/** What an ask was built with, as far as the gap's call reads it. */
export interface PacerGround {
  readonly riderPlace: RiderPlace | undefined;
  readonly gapTrend: PacerGapTrend | undefined;
  readonly riderInDraft: boolean;
  readonly terrain: PacerTerrain;
}

const ANY: readonly PacerIntent[] = ['hold', 'lift', 'ease'];

/** The intents the rider's place calls for. See the file comment's table. */
export function intentsCalledFor(ground: PacerGround): readonly PacerIntent[] {
  const { riderPlace, gapTrend, riderInDraft, terrain } = ground;
  if (pacerTerrainApplies(riderPlace, riderInDraft)) {
    if (terrain === 'before-climb') return ['ease'];
    if (terrain === 'descent' || terrain === 'over-the-top') return ['lift'];
    return ['hold'];
  }
  if (riderPlace === 'ahead') return gapTrend === 'rider-gaining' ? ['lift'] : ['hold', 'lift'];
  if (riderPlace === 'behind') return gapTrend === 'rider-losing' ? ['ease'] : ['hold', 'ease'];
  return ANY;
}

/** What became of an answer's line: the director's own word for it, or `voided`. */
export type PacerLine =
  /** Shown to the rider. */
  | 'shown'
  /** The model said nothing, or the answer was late, failed or not read for another reason. */
  | 'none'
  /** The answer was void: a key it may not carry, or a line the screen stops. */
  | 'voided'
  /** Hidden by the device: one of its last lines said again. */
  | 'repeat'
  /** Hidden by the device: the opposite of what the pacer was doing. */
  | 'against';

/** One ask of a ridden script. */
export interface PacerStep {
  readonly askedAtS: number;
  readonly ground: PacerGround;
  /** What the director logged for the ask's answer. */
  readonly outcome: PacerDecisionOutcome;
  /** The intent the device decided and rode from the ask, whatever the answer was. */
  readonly ridden: PacerIntent;
  /** Why the device decided it. */
  readonly reason: PacerReason;
  readonly line: PacerLine;
  /** The line the model wrote, for a `shown` or `repeat` one. Held for the scores, and never written to a results file. */
  readonly said?: string | undefined;
}

/** A scripted ride, ridden: what the scores are read off. */
export interface PacerRun {
  readonly steps: readonly PacerStep[];
  /** Every model call made, in order. */
  readonly calls: readonly ModelCall[];
}

/** What one ride came to. Numbers only. */
export interface PacerScore {
  readonly answers: number;
  readonly applied: number;
  readonly lateAnswers: number;
  readonly invalidAnswers: number;
  readonly failedAnswers: number;
  /** Decisions whose ridden intent the gap called for: every answer is one. */
  readonly intentsCalledFor: number;
  /** Decisions ridden as `ease` with the rider ahead. */
  readonly easedWithRiderAhead: number;
  readonly linesShown: number;
  /** Lines the model wrote in time and with the intent: shown, or hidden as a repeat. */
  readonly linesWritten: number;
  /** Of {@link linesWritten}, how many are distinct, and how many say an earlier one again. */
  readonly distinctLines: number;
  readonly repeatedLines: number;
  /** Lines the device hid as one of its last lines again. */
  readonly linesHiddenRepeat: number;
  /** Lines the device hid as against what the pacer was doing. */
  readonly linesHiddenAgainst: number;
  /** Answers that were void. */
  readonly linesVoided: number;
  readonly answerMs: Spread;
  readonly promptTokens: Spread;
  readonly outputTokens: Spread;
}

/** A line as two of them are compared: case, spacing and the marks at its end set aside. */
const comparable = (line: string): string =>
  line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const present = (values: readonly (number | undefined)[]): number[] =>
  values.filter((value): value is number => value !== undefined);

/** The scores of `run`. */
export function scorePacerRide(run: PacerRun): PacerScore {
  const { steps, calls } = run;
  const applied = steps.filter((step) => step.outcome === 'applied');
  const written = steps.flatMap((step) =>
    (step.line === 'shown' || step.line === 'repeat') && step.said !== undefined
      ? [comparable(step.said)]
      : [],
  );
  const count = (outcome: PacerDecisionOutcome): number =>
    steps.filter((step) => step.outcome === outcome).length;
  const lines = (line: PacerLine): number => steps.filter((step) => step.line === line).length;
  const answered = calls.filter((call) => call.text !== undefined);
  return {
    answers: steps.length,
    applied: applied.length,
    lateAnswers: count('late'),
    invalidAnswers: count('invalid'),
    failedAnswers: count('failed') + count('refused'),
    intentsCalledFor: steps.filter((step) => intentsCalledFor(step.ground).includes(step.ridden))
      .length,
    easedWithRiderAhead: steps.filter(
      (step) => step.ridden === 'ease' && step.ground.riderPlace === 'ahead',
    ).length,
    linesShown: lines('shown'),
    linesWritten: written.length,
    distinctLines: new Set(written).size,
    repeatedLines: written.length - new Set(written).size,
    linesHiddenRepeat: lines('repeat'),
    linesHiddenAgainst: lines('against'),
    linesVoided: lines('voided'),
    answerMs: spread(answered.map((call) => call.latencyMs)),
    promptTokens: spread(present(answered.map((call) => call.promptTokens))),
    outputTokens: spread(present(answered.map((call) => call.outputTokens))),
  };
}

/** The pass mark for the scripted ride. The reasons are in the file comment. */
export const PACER_PASS_MARK = {
  /** At least this share of decisions ride an intent the gap called for. */
  leastIntentShare: 0.8,
  /** At most this many decisions ridden as `ease` with the rider ahead. */
  mostEasedWithRiderAhead: 0,
  /** At least this share of the lines written are distinct. */
  leastDistinctLineShare: 0.8,
  /** At most this share of answers are void or have their line hidden as against the intent. */
  mostVoidedLineShare: 0.1,
  /** At least this share of answers are applied. */
  leastAppliedShare: 0.9,
  /** At most this many late answers. */
  mostLateAnswers: 0,
} as const;

/**
 * Every mark `score` falls under, none for a pass. A ride with no answers or
 * no line written fails the share it has nothing for: a
 * harness that reached no model has scored nothing.
 */
export function pacerShortfalls(score: PacerScore): readonly Shortfall[] {
  const short: Shortfall[] = [];
  const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);
  const under = (mark: string, scored: number, asked: number): void => {
    if (scored < asked) short.push({ mark, scored, asked });
  };
  const over = (mark: string, scored: number, asked: number): void => {
    if (scored > asked) short.push({ mark, scored, asked });
  };
  under(
    'intentShare',
    share(score.intentsCalledFor, score.answers),
    PACER_PASS_MARK.leastIntentShare,
  );
  over('easedWithRiderAhead', score.easedWithRiderAhead, PACER_PASS_MARK.mostEasedWithRiderAhead);
  under(
    'distinctLineShare',
    share(score.distinctLines, score.linesWritten),
    PACER_PASS_MARK.leastDistinctLineShare,
  );
  over(
    'voidedLineShare',
    share(score.linesVoided + score.linesHiddenAgainst, score.answers),
    PACER_PASS_MARK.mostVoidedLineShare,
  );
  under('appliedShare', share(score.applied, score.answers), PACER_PASS_MARK.leastAppliedShare);
  over('lateAnswers', score.lateAnswers, PACER_PASS_MARK.mostLateAnswers);
  return short;
}
