// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: **what one AI-pacer ride came to, and its pass
 * mark.** Pure: a ridden script in (`pacer-ride.ts` §`PacerRun`), numbers out.
 *
 * ## What is scored
 *
 * - **The intent ridden against what the gap called for**
 *   ({@link intentsCalledFor}): of the decisions applied, the share whose
 *   intent, as the device rode it, is one the rider's place called for.
 * - **Easing with the rider ahead**: decisions ridden as `ease` with the
 *   rider ahead of the pacer, counted on their own because no gap calls for
 *   it and ADR 0078's floor exists to stop it.
 * - **The lines**: how many were shown, how many of those were distinct, how
 *   many repeated an earlier one word for word, and how many the screen
 *   voided (`@onyourleft/domain` §`pacerSayProblem`, or a line against its
 *   own intent) or the device hid for contradicting the intent it rode.
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
 * - **At least 8 in 10 applied decisions ride an intent the gap called
 *   for.** The owner's ride of 2026-11-18 (#2835): "saying it is slowing down
 *   when behind me", and 2.5 minutes of `ease`. On the scripted ride of
 *   #2762, the model chose `ease` on 46 of 48 asks whatever the gap was. 8 in
 *   10 leaves room for the asks where the gap is turning and two readings
 *   are fair.
 * - **Never eased with the rider ahead.** "It says it will push yet I am
 *   ahead and never see it taking over" (#2777). ADR 0078's floor stops it
 *   once the rider has been ahead for ten seconds, and the script holds them
 *   ahead for a minute, so a count above nought is either the floor failing
 *   or the model easing in those first ten seconds, which #2835 asks to end.
 * - **At least 8 in 10 lines shown are distinct.** The owner's "did not vary
 *   much" (#2760): `pacer-1` said 18 distinct lines in 48, `pacer-2` 46.
 * - **At most 1 answer in 10 has its line voided or hidden.** A voided line
 *   costs the whole answer today, so a prompt that draws the screen often is
 *   a pacer that stops deciding.
 * - **At least 9 answers in 10 are applied, and none is late.** Every
 *   measured run on the owner's PC had 48 of 48 valid and none past the 5 s
 *   limit at 1.2 to 1.8 s a call.
 */

import {
  pacerTerrainApplies,
  type PacerDecisionOutcome,
  type PacerGapTrend,
  type PacerIntent,
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

/** What became of an answer's line. */
export type PacerLine =
  /** Shown to the rider. */
  | 'shown'
  /** The model said nothing, or the answer was not applied for another reason. */
  | 'none'
  /** The screen stopped it, and the answer with it. */
  | 'voided'
  /** The device rode another intent than the model's, and the line contradicted it. */
  | 'hidden';

/** One ask of a ridden script. */
export interface PacerStep {
  readonly askedAtS: number;
  readonly ground: PacerGround;
  /** What the director logged for it. */
  readonly outcome: PacerDecisionOutcome;
  /** The intent ridden, for an applied decision. */
  readonly ridden?: PacerIntent | undefined;
  readonly line: PacerLine;
  /** The line shown, for a `shown` one. Held for the scores, and never written to a results file. */
  readonly shown?: string | undefined;
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
  /** Applied decisions whose ridden intent the gap called for. */
  readonly intentsCalledFor: number;
  /** Applied decisions ridden as `ease` with the rider ahead. */
  readonly easedWithRiderAhead: number;
  readonly linesShown: number;
  readonly distinctLines: number;
  readonly repeatedLines: number;
  readonly linesVoided: number;
  readonly linesHidden: number;
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
  const lines = steps.flatMap((step) =>
    step.line === 'shown' && step.shown !== undefined ? [comparable(step.shown)] : [],
  );
  const count = (outcome: PacerDecisionOutcome): number =>
    steps.filter((step) => step.outcome === outcome).length;
  const answered = calls.filter((call) => call.text !== undefined);
  return {
    answers: steps.length,
    applied: applied.length,
    lateAnswers: count('late'),
    invalidAnswers: count('invalid'),
    failedAnswers: count('failed') + count('refused'),
    intentsCalledFor: applied.filter(
      (step) => step.ridden !== undefined && intentsCalledFor(step.ground).includes(step.ridden),
    ).length,
    easedWithRiderAhead: applied.filter(
      (step) => step.ridden === 'ease' && step.ground.riderPlace === 'ahead',
    ).length,
    linesShown: lines.length,
    distinctLines: new Set(lines).size,
    repeatedLines: lines.length - new Set(lines).size,
    linesVoided: steps.filter((step) => step.line === 'voided').length,
    linesHidden: steps.filter((step) => step.line === 'hidden').length,
    answerMs: spread(answered.map((call) => call.latencyMs)),
    promptTokens: spread(present(answered.map((call) => call.promptTokens))),
    outputTokens: spread(present(answered.map((call) => call.outputTokens))),
  };
}

/** The pass mark for the scripted ride. The reasons are in the file comment. */
export const PACER_PASS_MARK = {
  /** At least this share of applied decisions ride an intent the gap called for. */
  leastIntentShare: 0.8,
  /** At most this many decisions ridden as `ease` with the rider ahead. */
  mostEasedWithRiderAhead: 0,
  /** At least this share of the lines shown are distinct. */
  leastDistinctLineShare: 0.8,
  /** At most this share of answers have their line voided or hidden. */
  mostVoidedLineShare: 0.1,
  /** At least this share of answers are applied. */
  leastAppliedShare: 0.9,
  /** At most this many late answers. */
  mostLateAnswers: 0,
} as const;

/**
 * Every mark `score` falls under, none for a pass. A ride with no answers, no
 * decision applied or no line shown fails the share it has nothing for: a
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
    share(score.intentsCalledFor, score.applied),
    PACER_PASS_MARK.leastIntentShare,
  );
  over('easedWithRiderAhead', score.easedWithRiderAhead, PACER_PASS_MARK.mostEasedWithRiderAhead);
  under(
    'distinctLineShare',
    share(score.distinctLines, score.linesShown),
    PACER_PASS_MARK.leastDistinctLineShare,
  );
  over(
    'voidedLineShare',
    share(score.linesVoided + score.linesHidden, score.answers),
    PACER_PASS_MARK.mostVoidedLineShare,
  );
  under('appliedShare', share(score.applied, score.answers), PACER_PASS_MARK.leastAppliedShare);
  over('lateAnswers', score.lateAnswers, PACER_PASS_MARK.mostLateAnswers);
  return short;
}
