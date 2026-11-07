// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A threshold test's estimate, from the ride it was ridden on — #2307, under
 * the library epic #2295.
 *
 * Pure, and separate from the offer that shows it, for `library.ts`'s reason:
 * which part of a ride was the test, and what the offer says about it, are
 * decisions worth testing on their own.
 *
 * ## Which part of the ride was the test
 *
 * A test is ridden as a built-in (#2306), whose blocks are its template's
 * warm-up, its effort and its cool-down, in that order and unchanged — a test
 * offers no length, repeat or intensity to change (`library/test.ts`). The
 * ride saves each block where it began and how long it lasted
 * (`RideFacts.workoutBlocks`, #1319), so the effort is read from the saved
 * blocks: from where its first block began to where its last block ridden
 * ended. Nothing after it is the test, so a cool-down sprint is never a best
 * minute; a stop or *End workout* inside it ends the effort there.
 *
 * ## The estimate is the domain's
 *
 * `estimateThreshold` in `@onyourleft/domain` makes it, or refuses an
 * unfinished test with a sentence saying why. Its multipliers are conventions
 * from the training literature, and the offer says so in words made from
 * `THRESHOLD_TEST_RULES` — the numbers it computes with — so the two cannot
 * disagree.
 */

import {
  estimateThreshold,
  THRESHOLD_TEST_RULES,
  THRESHOLD_TESTS,
  watts,
  type ThresholdEstimate,
  type ThresholdTest,
  type ThresholdTestKind,
  type UnixSeconds,
  type Watts,
} from '@onyourleft/domain';
import type { Samples, WorkoutBlockFact } from '@onyourleft/store';

import { BUILT_IN_ID_PREFIX } from './built-in';

/** The threshold test a workout's id names, or `undefined` for any other workout. */
export function thresholdTestOf(workoutId: string): ThresholdTest | undefined {
  return THRESHOLD_TESTS.find((test) => `${BUILT_IN_ID_PREFIX}${test.template.id}` === workoutId);
}

/** A test ridden, and what its estimate came to. */
export interface TestRideEstimate {
  readonly test: ThresholdTestKind;
  readonly estimate: ThresholdEstimate;
}

/** The part of a saved ride that a ride's estimate is read from. */
export interface RideOfTest {
  /** The ride's workout blocks, in the order they came up. */
  readonly blocks: readonly WorkoutBlockFact[] | undefined;
  /** Where the test's own blocks begin among them: after any workout ridden before it. */
  readonly firstBlock: number;
  /** The instant of the ride's sample 0, and its spacing. */
  readonly startedAt: UnixSeconds;
  readonly sampleInterval: number;
  /** The ride's power, at its own spacing. */
  readonly power: Samples<'power'> | undefined;
}

/**
 * The test's estimate from the ride it was ridden on.
 *
 * Total: a ride with no blocks, an effort never reached, or one with no power
 * is the domain's refusal, never an error — its sentence says why.
 */
export function estimateFromRide(test: ThresholdTest, ride: RideOfTest): TestRideEstimate {
  // The test's own rows are the plan's blocks from the first one the recording
  // saw to the last (`recording/workout-blocks.ts`: a workout begun before the
  // recording has no rows for the blocks before the one it first sees, and
  // every block after the last ridden is a `skipped` row). So they are the
  // END of the plan, and the effort is found counting back from it, never
  // forward from a first row that may not be the first block.
  const rows = (ride.blocks ?? []).slice(ride.firstBlock);
  const plan = test.template;
  const unseen =
    plan.warmUp.length + plan.mainSet.blocks.length + plan.coolDown.length - rows.length;
  const effortFrom = plan.warmUp.length - unseen;
  const effort = rows.slice(
    Math.max(0, effortFrom),
    Math.max(0, effortFrom + plan.mainSet.blocks.length),
  );
  const ridden = effort.flatMap((block) => (block.outcome === 'skipped' ? [] : [block]));
  const first = ridden[0];
  const last = ridden.at(-1);
  // Sample indices, which are seconds because the recording's grid is 1 Hz
  // (#45) and `estimateThreshold` counts its series in seconds.
  const at = (instant: number): number => (instant - ride.startedAt) / ride.sampleInterval;
  const recording = {
    power: (ride.power ?? []).map((value) => (value === undefined ? undefined : watts(value))),
    effortStartsAt: first === undefined ? 0 : at(first.startedAt),
    effortEndsAt: last === undefined ? 0 : at(last.startedAt + last.elapsedTime),
  };
  return { test: test.kind, estimate: estimateThreshold(test.kind, recording) };
}

/** What each test is called in a sentence. */
const TEST_NAMES: Readonly<Record<ThresholdTestKind, string>> = {
  ramp: 'ramp test',
  'twenty-minute': '20-minute test',
};

/** The window the estimate is taken over, in words. */
function windowWords(test: ThresholdTestKind): string {
  return test === 'ramp' ? 'your best minute' : 'your twenty-minute average';
}

/**
 * The offer's first sentence: what the test suggests, and what the threshold
 * is now — a suggestion, worded as one.
 */
export function suggestionText(offer: TestRideEstimate, current: Watts | undefined): string {
  const name = TEST_NAMES[offer.test];
  if (offer.estimate.kind === 'refused') {
    return `Your ${name} made no threshold estimate. ${offer.estimate.reason}`;
  }
  const now = current === undefined ? 'you have none set now' : `it is ${String(current)} W now`;
  return (
    `Your ${name} suggests a threshold of ${String(offer.estimate.thresholdPower)} W ` + `(${now}).`
  );
}

/** The offer's second sentence: that the estimate is a convention, and which one. */
export function conventionText(test: ThresholdTestKind): string {
  const rule = THRESHOLD_TEST_RULES[test];
  return (
    `The estimate is a convention, not a measurement: ${String(rule.multiplier)} of ` +
    `${windowWords(test)}.`
  );
}
