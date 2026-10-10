// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_GOAL_POWER_CEILING,
  readWorkoutGoals,
  WORKOUT_GOAL_CONSTRAINTS,
  type WorkoutGoalsReading,
} from './goals';

const EVERY_GOAL = {
  sessionType: 'endurance',
  durationMinutes: 90,
  holdRange: { low: 130, high: 140 },
  heartRateAbove: 150,
  powerCeiling: 0.75,
  timeInRangeMinutes: 60,
  effortCheckIns: true,
} as const;

function faultOf(reading: WorkoutGoalsReading): { field: string; constraint: string } {
  if (reading.ok) {
    throw new Error('expected a fault, read goals');
  }
  return { field: reading.fault.field, constraint: reading.fault.constraint };
}

describe('readWorkoutGoals — #1236', () => {
  it('reads every goal, as a copy holding only the keys it knows', () => {
    const reading = readWorkoutGoals(EVERY_GOAL);
    expect(reading).toStrictEqual({ ok: true, goals: EVERY_GOAL });
    expect(reading.ok && reading.goals).not.toBe(EVERY_GOAL);
    expect(reading.ok && reading.goals.holdRange).not.toBe(EVERY_GOAL.holdRange);
  });

  it('reads no goals as no goals, and an undefined field as absent rather than a default', () => {
    expect(readWorkoutGoals({})).toStrictEqual({ ok: true, goals: {} });
    expect(readWorkoutGoals({ durationMinutes: undefined, sessionType: 'tempo' })).toStrictEqual({
      ok: true,
      goals: { sessionType: 'tempo' },
    });
  });

  it.each([
    ['null', null, 'workoutGoals', WORKOUT_GOAL_CONSTRAINTS.notAnObject],
    ['an array', [], 'workoutGoals', WORKOUT_GOAL_CONSTRAINTS.notAnObject],
    [
      'an unknown key',
      { ...EVERY_GOAL, target: 200 },
      'workoutGoals',
      WORKOUT_GOAL_CONSTRAINTS.unknownKey,
    ],
    [
      'an unknown key inside the range',
      { holdRange: { low: 130, high: 140, mid: 135 } },
      'workoutGoals.holdRange',
      WORKOUT_GOAL_CONSTRAINTS.unknownKey,
    ],
    [
      'an unknown session type',
      { sessionType: 'race' },
      'workoutGoals.sessionType',
      WORKOUT_GOAL_CONSTRAINTS.sessionType,
    ],
    [
      'a fractional duration',
      { durationMinutes: 45.5 },
      'workoutGoals.durationMinutes',
      WORKOUT_GOAL_CONSTRAINTS.durationMinutes,
    ],
    [
      'a duration under ten minutes',
      { durationMinutes: 9 },
      'workoutGoals.durationMinutes',
      WORKOUT_GOAL_CONSTRAINTS.durationMinutes,
    ],
    [
      'a duration over 300 minutes',
      { durationMinutes: 301 },
      'workoutGoals.durationMinutes',
      WORKOUT_GOAL_CONSTRAINTS.durationMinutes,
    ],
    [
      'a duration that is text',
      { durationMinutes: '60' },
      'workoutGoals.durationMinutes',
      WORKOUT_GOAL_CONSTRAINTS.durationMinutes,
    ],
    [
      'a range under 6 bpm wide',
      { holdRange: { low: 130, high: 135 } },
      'workoutGoals.holdRange',
      WORKOUT_GOAL_CONSTRAINTS.rangeWidth,
    ],
    [
      'a range whose low equals its high',
      { holdRange: { low: 140, high: 140 } },
      'workoutGoals.holdRange',
      WORKOUT_GOAL_CONSTRAINTS.rangeOrder,
    ],
    [
      'a range whose low is above its high',
      { holdRange: { low: 150, high: 140 } },
      'workoutGoals.holdRange',
      WORKOUT_GOAL_CONSTRAINTS.rangeOrder,
    ],
    [
      'a range with no high',
      { holdRange: { low: 130 } },
      'workoutGoals.holdRange.high',
      WORKOUT_GOAL_CONSTRAINTS.heartRate,
    ],
    [
      'a range low under 30 bpm',
      { holdRange: { low: 29, high: 140 } },
      'workoutGoals.holdRange.low',
      WORKOUT_GOAL_CONSTRAINTS.heartRate,
    ],
    [
      'a range that is not an object',
      { holdRange: 140 },
      'workoutGoals.holdRange',
      WORKOUT_GOAL_CONSTRAINTS.rangeNotAnObject,
    ],
    [
      'a range topping out above the heart rate chosen not to go above',
      { holdRange: { low: 140, high: 152 }, heartRateAbove: 150 },
      'workoutGoals.holdRange.high',
      WORKOUT_GOAL_CONSTRAINTS.rangeAboveCeiling,
    ],
    [
      'a heart rate over 230 bpm',
      { heartRateAbove: 231 },
      'workoutGoals.heartRateAbove',
      WORKOUT_GOAL_CONSTRAINTS.heartRate,
    ],
    [
      'a fractional heart rate',
      { heartRateAbove: 150.5 },
      'workoutGoals.heartRateAbove',
      WORKOUT_GOAL_CONSTRAINTS.heartRate,
    ],
    [
      'a ceiling over the ruled maximum',
      { powerCeiling: 0.86 },
      'workoutGoals.powerCeiling',
      WORKOUT_GOAL_CONSTRAINTS.powerCeiling,
    ],
    [
      'a ceiling under the smallest share',
      { powerCeiling: 0.1 },
      'workoutGoals.powerCeiling',
      WORKOUT_GOAL_CONSTRAINTS.powerCeiling,
    ],
    [
      'a ceiling that is not a number',
      { powerCeiling: Number.NaN },
      'workoutGoals.powerCeiling',
      WORKOUT_GOAL_CONSTRAINTS.powerCeiling,
    ],
    [
      'no minutes in range',
      { timeInRangeMinutes: 0 },
      'workoutGoals.timeInRangeMinutes',
      WORKOUT_GOAL_CONSTRAINTS.timeInRangeMinutes,
    ],
    [
      'more minutes in range than the session',
      { durationMinutes: 30, timeInRangeMinutes: 31 },
      'workoutGoals.timeInRangeMinutes',
      WORKOUT_GOAL_CONSTRAINTS.timeInRangeOverDuration,
    ],
    [
      'check-ins that are not on or off',
      { effortCheckIns: 'yes' },
      'workoutGoals.effortCheckIns',
      WORKOUT_GOAL_CONSTRAINTS.effortCheckIns,
    ],
  ])('refuses %s whole, naming the field and the constraint', (_name, value, field, constraint) => {
    const reading = readWorkoutGoals(value);
    expect(faultOf(reading)).toStrictEqual({ field, constraint });
    expect(reading).not.toHaveProperty('goals');
    if (!reading.ok) {
      expect(reading.fault.message).toBe(`${field}: ${constraint}`);
    }
  });

  it('admits the ceiling at exactly the ruled maximum and a range exactly 6 bpm wide', () => {
    expect(
      readWorkoutGoals({
        powerCeiling: MAXIMUM_GOAL_POWER_CEILING,
        holdRange: { low: 130, high: 136 },
      }).ok,
    ).toBe(true);
    expect(MAXIMUM_GOAL_POWER_CEILING).toBe(0.85);
  });

  it('admits a range topping out exactly at the heart rate chosen not to go above', () => {
    expect(readWorkoutGoals({ holdRange: { low: 140, high: 150 }, heartRateAbove: 150 }).ok).toBe(
      true,
    );
  });

  it('never names a value, and never calls a heart rate a health limit (ADR 0048 D-12)', () => {
    const banned =
      /\b(safe|safety|cardiac|heart condition|patient|therapy|limit for your heart)\b/i;
    for (const sentence of Object.values(WORKOUT_GOAL_CONSTRAINTS)) {
      expect(sentence).not.toMatch(banned);
    }
    const reading = readWorkoutGoals({ heartRateAbove: 777 });
    expect(reading.ok ? '' : reading.fault.message).not.toContain('777');
  });
});
