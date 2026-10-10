// SPDX-License-Identifier: Apache-2.0

/** Structured workouts — #14. The model, its timeline, and the ERG safety rule. */

export type { WorkoutErrorCode } from './errors';
export { WorkoutError } from './errors';

export type {
  FreeRideBlock,
  HeartRateHoldBlock,
  HeartRateRange,
  IntervalsBlock,
  RampBlock,
  SteadyBlock,
  ThresholdShare,
  Workout,
  WorkoutBlock,
} from './workout';

export {
  HOLD_FLOOR_SHARE,
  MAXIMUM_HOLD_BPM,
  MAXIMUM_HOLD_CEILING_SHARE,
  MINIMUM_HOLD_BPM,
  MINIMUM_HOLD_RANGE_BPM,
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
  WORKOUT_FILE_FIRST_VERSION,
  WORKOUT_FILE_MEDIA_TYPE,
  WORKOUT_FILE_VERSION,
  workoutFileVersionFor,
} from './format';

export {
  workoutBlockText,
  workoutDurationText,
  workoutPercent,
  workoutShapeText,
} from './describe';

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
  HeartRateHold,
  HeartRateHoldContext,
  HeartRateSample,
  HoldDecision,
  HoldEnvelope,
  HoldReason,
  TrainerPowerRange,
} from './heart-rate-hold';
export {
  createHeartRateHold,
  holdEligible,
  holdEnvelope,
  HOLD_DEADBAND_BPM,
  HOLD_IMPLAUSIBLE_JUMP_BPM,
  HOLD_IMPLAUSIBLE_JUMP_SECONDS,
  HOLD_MAXIMUM_RISE_WATTS,
  HOLD_MAXIMUM_STEP_DOWN_WATTS,
  HOLD_MAXIMUM_STEP_UP_WATTS,
  HOLD_MEAN_SECONDS,
  HOLD_OVERSHOOT_BPM,
  HOLD_OVERSHOOT_RECOVERY_SECONDS,
  HOLD_OVERSHOOT_SECONDS,
  HOLD_PLAUSIBLE_MAXIMUM_BPM,
  HOLD_PLAUSIBLE_MINIMUM_BPM,
  HOLD_RISE_WINDOW_SECONDS,
  HOLD_SETTLING_SECONDS,
  HOLD_SILENCE_FALLBACK_SECONDS,
  HOLD_SILENCE_MINIMUM_READINGS,
  HOLD_SILENCE_WINDOW_SECONDS,
  HOLD_UPDATE_SECONDS,
  HOLD_WATTS_PER_BPM,
  plausibleReadings,
} from './heart-rate-hold';

export type {
  HoldStatus,
  PlayerIntent,
  PlayerOptions,
  PlayerState,
  PlayerStatus,
  RiderSample,
  WorkoutPlayer,
  WorkoutRescue,
} from './player';
export { createWorkoutPlayer } from './player';
