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

// The items (#1899): pick-ups by lap fraction, position-weighted seeded draws,
// effects on the race offset only.
export type { RaceRandom } from './random';
export { nextUnit, raceRandom } from './random';

export type {
  Hazard,
  ItemKind,
  ItemRaceState,
  ItemRule,
  LapRacer,
  OffsetEffect,
  PositionBand,
} from './items';
export {
  BACK_OVER_FRONT_STRENGTH_METRES,
  drawItem,
  isLane,
  ITEM_KINDS,
  ITEM_RULES,
  ITEM_TABLE,
  itemStrength,
  LANE_COUNT,
  MAXIMUM_EFFECT_RATE_METRES_PER_SECOND,
  meanStrength,
  PICK_UP_FRACTIONS,
  pickUpsPassed,
  positionBand,
  PUDDLE_LIFETIME_MS,
  RAIN_CAPE_DURATION_MS,
  SLIPSTREAM_REACH_METRES,
  STARTING_LANE,
} from './items';

export type { ItemRaceSetup, RaceTickInput } from './item-race';
export { createItemRace, stepRace } from './item-race';
