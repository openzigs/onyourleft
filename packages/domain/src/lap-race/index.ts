// SPDX-License-Identifier: Apache-2.0

/** The lap race (#1894, ADR 0060): the platform-free model the device and the room share. */

export type { LapRaceErrorCode } from './errors';
export { LapRaceError } from './errors';

export type { RaceCourse, RacerState } from './race';
export {
  applyOffset,
  lapsAt,
  RACE_OFFSET_BOUND_METRES,
  raceCourse,
  racePosition,
  settle,
  standings,
  startingRacer,
  withEffortDistance,
} from './race';
