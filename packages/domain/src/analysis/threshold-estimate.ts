// SPDX-License-Identifier: Apache-2.0

/**
 * A threshold estimate from a completed threshold test — #2303, under the
 * library epic #2295.
 *
 * Two published protocols, and the arithmetic every surveyed app uses on them:
 *
 * - **A ramp test**: the estimate is **0.75 × the best one-minute average
 *   power** ridden during the ramp.
 * - **A 20-minute test**: the estimate is **0.95 × the twenty-minute average
 *   power** of the effort.
 *
 * ⚠️ **These multipliers are conventions from the training literature, not
 * this project's claim of accuracy**, and a screen that offers the estimate
 * says so (#2307). They are written down once, in {@link THRESHOLD_TEST_RULES},
 * so that a screen quoting them and this function computing with them cannot
 * disagree.
 *
 * ## A gap is never zero
 *
 * The best averages come from `power-duration.ts` §`bestMeanPower`, never from
 * a second implementation, so its gap rule is this module's too: a window that
 * is not entirely covered by real samples yields no effort. A dropout in the
 * best minute therefore takes that minute out of the running rather than
 * scoring its missing seconds as zero watts (`zones.ts` Rule 2), and the
 * estimate comes from the best minute power was actually heard for.
 *
 * ## Refuse an unfinished test, rather than guess from it
 *
 * A recording that did not ride the test's minimum — a ramp abandoned in its
 * warm-up, a 20-minute effort stopped at ten — gets a refusal with a sentence
 * saying why, and **no number**. An estimate from half a test is a number a
 * rider would accept and train against, and nothing on the screen could tell
 * them it was half a test.
 *
 * ## Naming
 *
 * This is a **threshold estimate** of **threshold power**, the project's
 * wording (ADR 0048 D-12). It uses none of the load-metric marks
 * (`docs/agents/scope-and-ip.md` §6), and its output is checked for them.
 */

import { watts, type Watts } from '../quantities';

import { bestMeanPower, type PowerSeries } from './power-duration';

/** Which threshold test a recording is of. */
export type ThresholdTestKind = 'ramp' | 'twenty-minute';

/** How one kind of test turns a recording into an estimate. */
export interface ThresholdTestRule {
  /** The window whose best average power the estimate is taken from, in seconds. */
  readonly windowSeconds: number;
  /** The share of that average the estimate is: a convention, not a measurement. */
  readonly multiplier: number;
  /**
   * The least of the test's effort, in seconds, that a recording must hold
   * before any estimate is made from it.
   */
  readonly minimumSeconds: number;
}

/**
 * The two tests' rules.
 *
 * - **Ramp**: the best minute, × 0.75; at least **three steps** of the ramp
 *   ridden. Its first steps sit well under threshold, so a ramp given up in
 *   its first three minutes says only that its starting targets were too hard
 *   for the threshold it was ridden against, and an estimate from them would
 *   be a number about the warm-up.
 * - **Twenty-minute**: the twenty-minute average, × 0.95; the **whole twenty
 *   minutes** ridden, because the protocol is an average over exactly that.
 */
export const THRESHOLD_TEST_RULES: Readonly<Record<ThresholdTestKind, ThresholdTestRule>> = {
  ramp: { windowSeconds: 60, multiplier: 0.75, minimumSeconds: 180 },
  'twenty-minute': { windowSeconds: 1200, multiplier: 0.95, minimumSeconds: 1200 },
};

/** A test as it was ridden. */
export interface ThresholdTestRecording {
  /**
   * Power at 1 Hz from the workout's start, with `undefined` where no power
   * was reported (`power-duration.ts`'s series, and its sampling rule).
   */
  readonly power: PowerSeries;
  /** Where the test's effort began, in seconds from the workout's start. */
  readonly effortStartsAt: number;
  /**
   * Where it ended, in the same seconds: its written end, or the stall, the
   * rider's *I'm done* or the stop that ended it sooner. Nothing after it is
   * the test, so a cool-down sprint can never become a best minute.
   */
  readonly effortEndsAt: number;
}

/** An estimate, or a refusal to make one. */
export type ThresholdEstimate =
  | {
      readonly kind: 'estimate';
      /** The estimate, in whole watts: what a rider would set their threshold to. */
      readonly thresholdPower: Watts;
      /** The best average it was taken from, over {@link windowSeconds}. */
      readonly basis: Watts;
      readonly windowSeconds: number;
      readonly multiplier: number;
    }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Estimate threshold power from a threshold test's recording.
 *
 * Total: it returns an estimate or a refusal, and never throws on a recording
 * — a short one, an empty one or one of nothing but gaps is a refusal.
 */
export function estimateThreshold(
  test: ThresholdTestKind,
  recording: ThresholdTestRecording,
): ThresholdEstimate {
  const rule = THRESHOLD_TEST_RULES[test];
  // Whole seconds of the effort only: sample `i` is the second [i, i + 1), so
  // the first is the one at or after the start and the last ends by the end.
  const first = Math.max(0, Math.ceil(recording.effortStartsAt));
  const last = Math.min(recording.power.length, Math.floor(recording.effortEndsAt));
  const ridden = Math.max(0, last - first);

  if (!(ridden >= rule.minimumSeconds)) {
    return { kind: 'refused', reason: unfinished(test, rule, ridden) };
  }

  const best = bestMeanPower(recording.power.slice(first, last), rule.windowSeconds);
  if (best === undefined) {
    return {
      kind: 'refused',
      reason:
        `No ${windowText(rule.windowSeconds)} stretch of the test has power in every second, so no ` +
        'estimate is made: a dropout is never counted as zero watts.',
    };
  }
  if (best <= 0) {
    return {
      kind: 'refused',
      reason: 'No power above zero was recorded during the test, so no estimate is made.',
    };
  }

  return {
    kind: 'estimate',
    thresholdPower: watts(Math.round(best * rule.multiplier)),
    basis: best,
    windowSeconds: rule.windowSeconds,
    multiplier: rule.multiplier,
  };
}

function unfinished(test: ThresholdTestKind, rule: ThresholdTestRule, ridden: number): string {
  const had =
    ridden === 0
      ? 'none of it was ridden'
      : ridden === 1
        ? '1 second of it was ridden'
        : `${String(ridden)} seconds of it were ridden`;
  return test === 'ramp'
    ? `An estimate needs at least ${minutesText(rule.minimumSeconds)} of the ramp's steps, ` +
        `and ${had}. If its first steps were too hard, lower your threshold and ride it again.`
    : `An estimate needs the whole ${String(rule.minimumSeconds / 60)}-minute effort, and ${had}.`;
}

/** `60` → `"minute-long"`, `1200` → `"20-minute"`. */
function windowText(windowSeconds: number): string {
  return windowSeconds === 60 ? 'minute-long' : `${String(windowSeconds / 60)}-minute`;
}

function minutesText(totalSeconds: number): string {
  return `${String(totalSeconds / 60)} minutes`;
}
