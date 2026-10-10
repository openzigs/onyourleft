// SPDX-License-Identifier: Apache-2.0

/** Structured workouts — #14. The model, its timeline, and the ERG safety rule. */

export type { WorkoutErrorCode } from './errors';
export { WorkoutError } from './errors';

export type {
  FreeRideBlock,
  IntervalsBlock,
  RampBlock,
  SteadyBlock,
  ThresholdShare,
  Workout,
  WorkoutBlock,
} from './workout';

export {
  MAXIMUM_REPEATS,
  MAXIMUM_SEGMENTS,
  MAXIMUM_SHARE,
  MINIMUM_SHARE,
  thresholdShare,
  validateWorkout,
  workoutSegmentCount,
} from './workout';

export type {
  HeartRateRange,
  WorkoutGoals,
  WorkoutGoalsFault,
  WorkoutGoalsReading,
  WorkoutSessionType,
} from './goals';
export {
  MAXIMUM_GOAL_DURATION_MINUTES,
  MAXIMUM_GOAL_HEART_RATE,
  MAXIMUM_GOAL_POWER_CEILING,
  MINIMUM_GOAL_DURATION_MINUTES,
  MINIMUM_GOAL_HEART_RATE,
  MINIMUM_HOLD_RANGE_WIDTH,
  readWorkoutGoals,
  WORKOUT_GOAL_CONSTRAINTS,
  WORKOUT_SESSION_TYPES,
} from './goals';

export type { WorkoutFile } from './format';
export {
  decodeWorkoutFile,
  encodeWorkoutFile,
  MAXIMUM_WORKOUT_FILE_CHARACTERS,
  WORKOUT_FILE_EXTENSION,
  WORKOUT_FILE_MEDIA_TYPE,
  WORKOUT_FILE_VERSION,
} from './format';

export type { WorkoutSegment, WorkoutTimeline } from './timeline';
export { expandWorkout, segmentAt, targetAt } from './timeline';

export type { CadenceReading, ErgRescue, ErgRescueStep, ErgVerdict } from './erg-safety';
export {
  assessErgCadence,
  COLLAPSE_RPM,
  createErgRescue,
  CADENCE_SILENT_REASON,
  RECOVERING_REASON,
  RELIEF_SHARE,
  STALLING_CADENCE,
  STOPPED_CADENCE,
  TREND_WINDOW,
} from './erg-safety';

export type {
  PlayerIntent,
  PlayerOptions,
  PlayerState,
  PlayerStatus,
  RiderSample,
  WorkoutPlayer,
  WorkoutRescue,
} from './player';
export { createWorkoutPlayer } from './player';
