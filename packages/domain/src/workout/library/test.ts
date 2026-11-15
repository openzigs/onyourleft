// SPDX-License-Identifier: Apache-2.0

/**
 * The two threshold tests, as built-in templates — #2303, under the library
 * epic #2295.
 *
 * Every library workout is written as shares of the rider's threshold, and
 * until these there was no way in the app to find one. The protocols are
 * published training facts (spike 0038 §1: *"A published test protocol (a
 * ramp in one-minute steps; a 20-minute test) and its arithmetic"*); the
 * names and the words are our own.
 *
 * - {@link RAMP_TEST}: a warm-up, then one-minute steps rising by
 *   {@link RAMP_STEP_SHARE} of threshold until the rider cannot hold the
 *   target. `analysis/threshold-estimate.ts` takes 0.75 of the best minute.
 * - {@link TWENTY_MINUTE_TEST}: a warm-up and openers, then twenty minutes
 *   ridden as a **free-ride block** — rider-paced, the trainer released — and
 *   0.95 of its average.
 *
 * Both are `scaling: 'fixed'` and offer no intensity offset, so
 * `tailorWorkout` refuses a length, a repeat count and an intensity for them:
 * a test ridden shorter or easier is not the test its arithmetic assumes.
 *
 * ## ⚠️ A ramp test ends in a stall by design
 *
 * A ramp in ERG finishes when the rider can no longer turn the pedals against
 * the target — the spiral of death in its purest form. Two things here keep
 * that end a release of the trainer rather than the stall rescue racing a
 * target that keeps rising:
 *
 * 1. **The ramp is capped**: its steps stop at {@link RAMP_MAXIMUM_SHARE} of
 *    threshold, so a rider who never fails rides into the cool-down, not
 *    towards `MAXIMUM_SHARE`.
 * 2. **Its cool-down is a free ride**, and `test-player.ts` ends the ramp on
 *    the first stall-rescue verdict or the rider's *I'm done*. Ending it puts
 *    the rider in that free ride at once, which the player answers with
 *    `release` — the existing release path, and no new writer.
 */

import type { ThresholdTestKind } from '../../analysis/threshold-estimate';
import { seconds } from '../../quantities';
import type { FixedMainSet, WorkoutTemplate } from '../template';
import { thresholdShare, type WorkoutBlock } from '../workout';

/** A threshold test: the template it is ridden as, and the rule its estimate uses. */
export interface ThresholdTest {
  readonly kind: ThresholdTestKind;
  /** The main set is the test's effort, ridden exactly as written. */
  readonly template: WorkoutTemplate & { readonly mainSet: FixedMainSet };
}

/** The ramp's first step, as a share of threshold. */
export const RAMP_START_SHARE = 0.6;

/**
 * How much each step adds, as a share of threshold: 6 %, the common step the
 * epic's survey found (#2295). Some apps use a fixed 10 or 20 W instead; a
 * share keeps the test the same shape for every rider, as every other target
 * in a workout is.
 */
export const RAMP_STEP_SHARE = 0.06;

/** How long each step lasts, in seconds: one minute. */
export const RAMP_STEP_SECONDS = 60;

/**
 * The highest step the ramp has, as a share of threshold: 2.0.
 *
 * ⚠️ **The declared maximum, and a safety bound rather than a training one.**
 * A rider who reaches it has a threshold well above the one the test was
 * ridden against; the ramp ends there and the cool-down releases the trainer.
 * Without it, a ramp written to run "until you fail" would be written to run
 * towards `MAXIMUM_SHARE`.
 */
export const RAMP_MAXIMUM_SHARE = 2;

/**
 * The ramp's steps: from {@link RAMP_START_SHARE}, up by
 * {@link RAMP_STEP_SHARE}, and none above {@link RAMP_MAXIMUM_SHARE}.
 */
function rampSteps(): readonly WorkoutBlock[] {
  const steps: WorkoutBlock[] = [];
  for (let step = 0; ; step += 1) {
    // In hundredths, so the 24th step is 1.98 and not 1.9800000000000002.
    const share = Math.round((RAMP_START_SHARE + step * RAMP_STEP_SHARE) * 100) / 100;
    if (share > RAMP_MAXIMUM_SHARE) {
      return steps;
    }
    steps.push({
      kind: 'steady',
      seconds: seconds(RAMP_STEP_SECONDS),
      target: thresholdShare(share),
      label: `Step ${String(step + 1)}`,
    });
  }
}

/** The ramp test. */
export const RAMP_TEST: ThresholdTest = {
  kind: 'ramp',
  template: {
    id: 'ramp-test',
    name: 'Ramp test',
    summary:
      'One-minute steps that rise until you cannot hold the target; your threshold estimate ' +
      'is three quarters of your best minute.',
    category: 'test',
    warmUp: [
      {
        kind: 'ramp',
        seconds: seconds(480),
        from: thresholdShare(0.45),
        to: thresholdShare(RAMP_START_SHARE),
        label: 'Warm-up',
      },
    ],
    mainSet: { scaling: 'fixed', blocks: rampSteps() },
    // A free ride, and that is the safety half of the design (see the module
    // note): whatever ends the ramp, what follows asks the trainer for nothing.
    coolDown: [{ kind: 'free-ride', seconds: seconds(600), label: 'Cool-down, at your own pace' }],
    parameters: { intensityPercent: { minimum: 0, maximum: 0 } },
  },
};

/** The twenty-minute test. */
export const TWENTY_MINUTE_TEST: ThresholdTest = {
  kind: 'twenty-minute',
  template: {
    id: 'twenty-minute-test',
    name: '20-minute test',
    summary:
      'A warm-up and three openers, then twenty minutes as hard as you can hold them with the ' +
      'trainer released; your threshold estimate is 95 % of that average.',
    category: 'test',
    warmUp: [
      {
        kind: 'ramp',
        seconds: seconds(600),
        from: thresholdShare(0.45),
        to: thresholdShare(0.65),
        label: 'Warm-up',
      },
      {
        kind: 'intervals',
        repeats: 3,
        hardSeconds: seconds(60),
        hardTarget: thresholdShare(1.05),
        easySeconds: seconds(60),
        easyTarget: thresholdShare(0.5),
        label: 'Openers',
      },
      { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.5), label: 'Easy' },
    ],
    mainSet: {
      scaling: 'fixed',
      blocks: [
        { kind: 'free-ride', seconds: seconds(1200), label: 'Twenty minutes, as hard as you can' },
      ],
    },
    coolDown: [
      {
        kind: 'ramp',
        seconds: seconds(600),
        from: thresholdShare(0.6),
        to: thresholdShare(0.45),
        label: 'Cool-down',
      },
    ],
    parameters: { intensityPercent: { minimum: 0, maximum: 0 } },
  },
};

/** Both tests, the ramp first. */
export const THRESHOLD_TESTS: readonly ThresholdTest[] = [RAMP_TEST, TWENTY_MINUTE_TEST];
