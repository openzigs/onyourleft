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
  MAXIMUM_SHARE,
  MINIMUM_SHARE,
  thresholdShare,
  validateWorkout,
} from './workout';

export type { WorkoutSegment, WorkoutTimeline } from './timeline';
export { expandWorkout, segmentAt, targetAt } from './timeline';

export type { CadenceReading, ErgVerdict } from './erg-safety';
export {
  assessErgCadence,
  COLLAPSE_RPM,
  RELIEF_SHARE,
  STALLING_CADENCE,
  STOPPED_CADENCE,
  TREND_WINDOW,
} from './erg-safety';
