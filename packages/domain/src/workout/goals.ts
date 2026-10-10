// SPDX-License-Identifier: Apache-2.0

/**
 * Typed workout goals — #1236, ADR 0048 D-10 (the owner's Q9).
 *
 * ## What these are, and what they are not
 *
 * The rider's own choices that **bound** what a heart-rate hold or a re-plan
 * during the ride may do: the range they want held, a heart rate they do not
 * want to go above, a power ceiling as a share of their own threshold, and so
 * on. They are deliberately a different thing from #836's free-text goals,
 * which the analysis agent reads and which **never** set a bound: only a typed
 * goal can, so only a typed goal is checked here.
 *
 * Every field is optional, and **an absent field means "no goal", never a
 * default**. Nothing in this module invents a value the rider did not choose.
 *
 * ## Refused whole
 *
 * {@link readWorkoutGoals} either returns the goals, copied with only the keys
 * it knows, or returns one fault and **no goals at all** — never a partial
 * goal. An unknown key is refused rather than ignored, for ADR 0017 D-4's
 * reason: a future field that changed what a hold does would otherwise be
 * dropped silently, and the rider would ride something other than what they
 * chose against a machine applying resistance to them. The store runs it on
 * the way in **and** on the way out, so a hand-edited IndexedDB row reads back
 * as no goals with a fault.
 *
 * ## What is NOT checked here
 *
 * The bounds that depend on the athlete's own thresholds — the top of a hold's
 * range at or below 100 % of their threshold heart rate (ADR 0048 H2), the
 * ceiling as watts — are checked where a hold or a re-plan is computed, not
 * here, because a threshold can change after the goals were saved.
 *
 * ## Wording
 *
 * Every refusal sentence is in this module and names the field and the
 * constraint, never the value. ADR 0048 D-12: a heart rate here is *the range
 * you chose*, never a limit for health or safety, and no sentence says *safe*
 * or *cardiac*.
 */

import type { BeatsPerMinute } from '../quantities';
// The hold block's own range (#1239): one shape for a range a rider chose.
import type { HeartRateRange, ThresholdShare } from './workout';
import { MINIMUM_SHARE } from './workout';

/** The kinds of session a rider may say they are riding. */
export const WORKOUT_SESSION_TYPES = ['endurance', 'tempo', 'intervals', 'recovery'] as const;

/** One of {@link WORKOUT_SESSION_TYPES}. */
export type WorkoutSessionType = (typeof WORKOUT_SESSION_TYPES)[number];

/**
 * The rider's typed goals. Every field is optional; an absent one is no goal.
 */
export interface WorkoutGoals {
  readonly sessionType?: WorkoutSessionType;
  /** Whole minutes, {@link MINIMUM_GOAL_DURATION_MINUTES}..{@link MAXIMUM_GOAL_DURATION_MINUTES}. */
  readonly durationMinutes?: number;
  /** At least {@link MINIMUM_HOLD_RANGE_WIDTH} bpm wide. */
  readonly holdRange?: HeartRateRange;
  /** "Do not go above": the top of any hold's range sits at or below it. */
  readonly heartRateAbove?: BeatsPerMinute;
  /** At most {@link MAXIMUM_GOAL_POWER_CEILING} of the rider's own threshold (ADR 0048 H3). */
  readonly powerCeiling?: ThresholdShare;
  /** Whole minutes inside the range; never more than `durationMinutes`. */
  readonly timeInRangeMinutes?: number;
  /** A 1–5 tap between blocks, never during one. */
  readonly effortCheckIns?: boolean;
}

/** The shortest session a duration goal may name, in whole minutes. */
export const MINIMUM_GOAL_DURATION_MINUTES = 10;

/** The longest session a duration goal may name, in whole minutes. */
export const MAXIMUM_GOAL_DURATION_MINUTES = 300;

/**
 * The narrowest hold range, in beats per minute (ADR 0048 H2): heart rate lags
 * too much to hold anything tighter.
 */
export const MINIMUM_HOLD_RANGE_WIDTH = 6;

/**
 * The highest power ceiling a goal may set, as a share of the rider's own
 * threshold power (ADR 0048 H3, the owner's Q6). The hold is for endurance
 * work; a ceiling above this is refused rather than lowered.
 */
export const MAXIMUM_GOAL_POWER_CEILING = 0.85;

/**
 * The lowest and highest heart rate a goal may name, in beats per minute —
 * ADR 0048 H8's plausible band. A number outside it is a typing slip, not a
 * goal.
 */
export const MINIMUM_GOAL_HEART_RATE = 30;
export const MAXIMUM_GOAL_HEART_RATE = 230;

/** Why a value is not a set of workout goals: the field and the constraint. */
export interface WorkoutGoalsFault {
  /** Which field, as `workoutGoals.<name>`, or `workoutGoals` for the whole. */
  readonly field: string;
  /** What it must be. Never the value it was. */
  readonly constraint: string;
  /** `field: constraint`, the one sentence a caller shows or throws. */
  readonly message: string;
}

/** The goals, or the one reason there are none. */
export type WorkoutGoalsReading =
  | { readonly ok: true; readonly goals: WorkoutGoals }
  | { readonly ok: false; readonly fault: WorkoutGoalsFault };

const GOAL_KEYS: ReadonlySet<string> = new Set([
  'sessionType',
  'durationMinutes',
  'holdRange',
  'heartRateAbove',
  'powerCeiling',
  'timeInRangeMinutes',
  'effortCheckIns',
]);

const RANGE_KEYS: ReadonlySet<string> = new Set(['low', 'high']);

const SESSION_TYPES: ReadonlySet<string> = new Set(WORKOUT_SESSION_TYPES);

/**
 * Every refusal sentence, spelled once. Each names a constraint and never a
 * value; none calls a heart rate a limit for health.
 */
export const WORKOUT_GOAL_CONSTRAINTS = {
  notAnObject: 'must be an object of goals',
  unknownKey: 'is not a goal this app knows; the goals were not read',
  sessionType: `must be one of ${WORKOUT_SESSION_TYPES.join(', ')}`,
  durationMinutes: `must be whole minutes from ${String(MINIMUM_GOAL_DURATION_MINUTES)} to ${String(MAXIMUM_GOAL_DURATION_MINUTES)}`,
  heartRate: `must be a whole heart rate from ${String(MINIMUM_GOAL_HEART_RATE)} to ${String(MAXIMUM_GOAL_HEART_RATE)} bpm`,
  rangeNotAnObject: 'must be a range with a low and a high heart rate',
  rangeOrder: 'low must be below high',
  rangeWidth: `must be at least ${String(MINIMUM_HOLD_RANGE_WIDTH)} bpm wide`,
  rangeAboveCeiling:
    'the top of the range you chose must be at or below the heart rate you chose not to go above',
  powerCeiling: `must be a share of your own threshold power from ${String(MINIMUM_SHARE)} to ${String(MAXIMUM_GOAL_POWER_CEILING)}`,
  timeInRangeMinutes: `must be whole minutes from 1 to ${String(MAXIMUM_GOAL_DURATION_MINUTES)}`,
  timeInRangeOverDuration: 'must be no longer than the duration you chose',
  effortCheckIns: 'must be on or off',
} as const;

function fault(field: string, constraint: string): WorkoutGoalsReading {
  const name = field === '' ? 'workoutGoals' : `workoutGoals.${field}`;
  return { ok: false, fault: { field: name, constraint, message: `${name}: ${constraint}` } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWholeBetween(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
}

function isGoalHeartRate(value: unknown): value is number {
  return isWholeBetween(value, MINIMUM_GOAL_HEART_RATE, MAXIMUM_GOAL_HEART_RATE);
}

/**
 * Reads a value as typed workout goals — a form's answer, a store row, or a
 * synced item alike. Pure: it reads only its argument and returns a new
 * object holding only the keys it knows, so nothing a caller spread in is
 * carried along.
 *
 * A key whose value is `undefined` is read as absent, because structured clone
 * keeps such a key and an absent goal is no goal.
 */
export function readWorkoutGoals(value: unknown): WorkoutGoalsReading {
  if (!isRecord(value)) {
    return fault('', WORKOUT_GOAL_CONSTRAINTS.notAnObject);
  }
  for (const key of Object.keys(value)) {
    if (!GOAL_KEYS.has(key)) {
      return fault('', WORKOUT_GOAL_CONSTRAINTS.unknownKey);
    }
  }
  const goals: {
    sessionType?: WorkoutSessionType;
    durationMinutes?: number;
    holdRange?: HeartRateRange;
    heartRateAbove?: BeatsPerMinute;
    powerCeiling?: ThresholdShare;
    timeInRangeMinutes?: number;
    effortCheckIns?: boolean;
  } = {};

  const { sessionType } = value;
  if (sessionType !== undefined) {
    if (typeof sessionType !== 'string' || !SESSION_TYPES.has(sessionType)) {
      return fault('sessionType', WORKOUT_GOAL_CONSTRAINTS.sessionType);
    }
    goals.sessionType = sessionType as WorkoutSessionType;
  }

  const { durationMinutes } = value;
  if (durationMinutes !== undefined) {
    if (
      !isWholeBetween(durationMinutes, MINIMUM_GOAL_DURATION_MINUTES, MAXIMUM_GOAL_DURATION_MINUTES)
    ) {
      return fault('durationMinutes', WORKOUT_GOAL_CONSTRAINTS.durationMinutes);
    }
    goals.durationMinutes = durationMinutes;
  }

  const { heartRateAbove } = value;
  if (heartRateAbove !== undefined) {
    if (!isGoalHeartRate(heartRateAbove)) {
      return fault('heartRateAbove', WORKOUT_GOAL_CONSTRAINTS.heartRate);
    }
    goals.heartRateAbove = heartRateAbove as BeatsPerMinute;
  }

  const { holdRange } = value;
  if (holdRange !== undefined) {
    if (!isRecord(holdRange)) {
      return fault('holdRange', WORKOUT_GOAL_CONSTRAINTS.rangeNotAnObject);
    }
    for (const key of Object.keys(holdRange)) {
      if (!RANGE_KEYS.has(key)) {
        return fault('holdRange', WORKOUT_GOAL_CONSTRAINTS.unknownKey);
      }
    }
    const { low, high } = holdRange;
    if (!isGoalHeartRate(low)) {
      return fault('holdRange.low', WORKOUT_GOAL_CONSTRAINTS.heartRate);
    }
    if (!isGoalHeartRate(high)) {
      return fault('holdRange.high', WORKOUT_GOAL_CONSTRAINTS.heartRate);
    }
    if (low >= high) {
      return fault('holdRange', WORKOUT_GOAL_CONSTRAINTS.rangeOrder);
    }
    if (high - low < MINIMUM_HOLD_RANGE_WIDTH) {
      return fault('holdRange', WORKOUT_GOAL_CONSTRAINTS.rangeWidth);
    }
    if (goals.heartRateAbove !== undefined && high > goals.heartRateAbove) {
      return fault('holdRange.high', WORKOUT_GOAL_CONSTRAINTS.rangeAboveCeiling);
    }
    goals.holdRange = { low: low as BeatsPerMinute, high: high as BeatsPerMinute };
  }

  const { powerCeiling } = value;
  if (powerCeiling !== undefined) {
    if (
      typeof powerCeiling !== 'number' ||
      !Number.isFinite(powerCeiling) ||
      powerCeiling < MINIMUM_SHARE ||
      powerCeiling > MAXIMUM_GOAL_POWER_CEILING
    ) {
      return fault('powerCeiling', WORKOUT_GOAL_CONSTRAINTS.powerCeiling);
    }
    goals.powerCeiling = powerCeiling as ThresholdShare;
  }

  const { timeInRangeMinutes } = value;
  if (timeInRangeMinutes !== undefined) {
    if (!isWholeBetween(timeInRangeMinutes, 1, MAXIMUM_GOAL_DURATION_MINUTES)) {
      return fault('timeInRangeMinutes', WORKOUT_GOAL_CONSTRAINTS.timeInRangeMinutes);
    }
    if (goals.durationMinutes !== undefined && timeInRangeMinutes > goals.durationMinutes) {
      return fault('timeInRangeMinutes', WORKOUT_GOAL_CONSTRAINTS.timeInRangeOverDuration);
    }
    goals.timeInRangeMinutes = timeInRangeMinutes;
  }

  const { effortCheckIns } = value;
  if (effortCheckIns !== undefined) {
    if (typeof effortCheckIns !== 'boolean') {
      return fault('effortCheckIns', WORKOUT_GOAL_CONSTRAINTS.effortCheckIns);
    }
    goals.effortCheckIns = effortCheckIns;
  }

  return { ok: true, goals };
}
