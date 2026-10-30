// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The longest sentence `workout/replan-text.ts` §`replanSentence` can produce
 * — #1324. The game's HUD shows a waiting move's sentence above *Keep the
 * plan*, and the sentence that binds the actions panel's height is the one
 * that wraps furthest. `ride-harness.tsx` §`REPLAN_WAITING` rides with it and
 * `ride-workout.browser.spec.ts` §"#1324" reads it back off the HUD.
 *
 * Found by composing every move from the decoder's own lists
 * (`@onyourleft/domain` §`REPLAN_BLOCK_MINUTES` and its siblings), with every
 * reason and with none, at the next block and at the furthest block a workout
 * can have (`MAXIMUM_SEGMENTS`), rather than named: a new move, reason or
 * number then changes the sentence measured without anyone choosing it again.
 */

import {
  MAXIMUM_SEGMENTS,
  REASON_CODES,
  REPLAN_BLOCK_MINUTES,
  REPLAN_HOLD_RANGE_BPM,
  REPLAN_SCALE_PERCENTS,
  type PlanMove,
} from '@onyourleft/domain';

import { replanSentence } from '../src/workout/replan-text';

export function longestReplanSentence(): string {
  const next = 2;
  const blocks = [next, MAXIMUM_SEGMENTS - 1];
  const moves: PlanMove[] = [
    ...blocks.flatMap((block) =>
      REPLAN_BLOCK_MINUTES.flatMap((minutes) => [
        { kind: 'extend-block' as const, block, minutes },
        { kind: 'shorten-block' as const, block, minutes },
      ]),
    ),
    ...REPLAN_SCALE_PERCENTS.map((percent) => ({
      kind: 'scale-remaining-intervals' as const,
      percent,
    })),
    ...blocks.flatMap((block) =>
      REPLAN_HOLD_RANGE_BPM.map((bpm) => ({ kind: 'move-hold-range' as const, block, bpm })),
    ),
    { kind: 'swap-next-block', workoutId: 'saved', blockIndex: 0 },
    { kind: 'end-main-set' },
  ];
  const sentences = moves.flatMap((move) =>
    [...REASON_CODES, undefined].map((reason) => replanSentence(move, reason, next)),
  );
  return sentences.reduce((longest, each) => (each.length > longest.length ? each : longest));
}
