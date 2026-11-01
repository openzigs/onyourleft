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
  GUST_REACH_METRES,
  isLane,
  ITEM_KINDS,
  ITEM_RULES,
  ITEM_TABLE,
  itemStrength,
  LANE_COUNT,
  MAXIMUM_EFFECT_RATE_METRES_PER_SECOND,
  meanStrength,
  nextPickUpPoint,
  OFFSET_DRIFT_METRES_PER_SECOND,
  PICK_UP_FRACTIONS,
  pickUpsPassed,
  positionBand,
  PUDDLE_LIFETIME_MS,
  RAIN_CAPE_DURATION_MS,
  STARTING_LANE,
  TOW_REACH_METRES,
} from './items';

export type { ItemRaceSetup, RaceTickInput } from './item-race';
export { createItemRace, stepRace } from './item-race';

// The bots (#1900): W/kg tiers at the #92 bot's fixed mass, and seeded
// decisions over the race as it stands. Their effort is the physics' own
// (`@onyourleft/physics` §`stepBotRace`).
export type { BotDecision, BotTier } from './bots';
export {
  BOT_AIM_METRES,
  BOT_DODGE,
  BOT_PUDDLE_LOOKAHEAD_METRES,
  BOT_REACTION,
  BOT_THREAT_METRES,
  BOT_TIER_WATTS_PER_KILOGRAM,
  BOT_TIERS,
  botDecision,
  botTierPlan,
} from './bots';

// The bots' strategy (#1959): item timing by what a use is worth, lane
// tactics with a dwell, personalities and a skill level. Decisions only: no
// power, so D-9 is untouched.
export type {
  BotMemory,
  BotPersonality,
  BotSkill,
  BotStrategy,
  BotWeights,
  LinedUpRival,
  StrategicBotDecision,
} from './strategy';
export {
  BOT_FINISH_WINDOW_METRES,
  BOT_LANE_DWELL_MS,
  BOT_LANE_STAY_METRES,
  BOT_LAST_CALL_METRES,
  BOT_MEMORY_AT_START,
  BOT_MISJUDGE_METRES,
  BOT_PERSONALITIES,
  BOT_PERSONALITY_WEIGHTS,
  BOT_PUDDLE_REACH_METRES,
  BOT_RELINE_MS,
  BOT_SKILL_LEVEL,
  BOT_SKILL_MISJUDGEMENT,
  BOT_SKILLS,
  botFieldPersonalities,
  strategicBotDecision,
} from './strategy';
