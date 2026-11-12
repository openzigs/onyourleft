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
  botFieldSkills,
  strategicBotDecision,
} from './strategy';

// The bots' race plan (#1960, ADR 0061): sets a bot's power from its tier, the
// road, the effort distance it has left and its own W′ balance (#2458, ADR
// 0067 D-2), a capacity fixed at the start that no rank or gap changes.
// Each bot's own pace (#2455): an ability at or under its tier and a pacing
// style read off the course, dealt from the race's seed before the start.
export type { BotPace, BotPacingStyle } from './pace';
export {
  BOT_ABILITY_SPREAD,
  BOT_EVEN_PACE,
  BOT_PACING_STYLES,
  BOT_STYLE_EASING,
  botFieldPaces,
  checkBotPace,
} from './pace';

// Each bot's rider archetype, a power profile within its tier read off its
// pacing style, and the tactics skill's misjudgement of the race (#2459, ADR
// 0067 D-1.1 and D-7). Capacity at the start only; nothing reads the race.
export type { BotArchetype, BotAttackPropensity, BotMisjudgement } from './archetype';
export {
  BOT_ARCHETYPE_ATTACK_PROPENSITY,
  BOT_ARCHETYPE_CLIMB_GRADE_PERCENT,
  BOT_ARCHETYPE_CP_SHARE,
  BOT_ARCHETYPE_PEAK_SHARE,
  BOT_ARCHETYPE_RECOVERY_FACTOR,
  BOT_ARCHETYPE_SPRINT_FACTOR,
  BOT_ARCHETYPE_WPRIME_FACTOR,
  BOT_ARCHETYPES,
  BOT_STYLE_ARCHETYPE,
  BOT_TACTICS_MISJUDGE_GAP_METRES,
  BOT_TACTICS_MISJUDGE_LINE_METRES,
  BOT_TACTICS_MISJUDGE_WBAL_SHARE,
  BOT_TACTICS_WINDOW_MS,
  botArchetype,
  botFieldArchetypes,
  botTacticsMisjudgement,
} from './archetype';

// Each bot's race-aware tactics (#2462, ADR 0067 D-0, D-1, D-7): utility over
// seven states, chosen once per decision window, telling the power model how
// hard to ride inside a capacity it never changes. Wired into the race by #2463.
export type { BotTactic, RaceView, TacticDecision, TacticMemory } from './tactics';
export {
  BOT_TACTIC_ATTACK_MS,
  BOT_TACTIC_ATTACK_SURGE,
  BOT_TACTIC_BRIDGE_METRES,
  BOT_TACTIC_CHASE_SURGE,
  BOT_TACTIC_CLIMB_GRADE_PERCENT,
  BOT_TACTIC_COMMITMENT,
  BOT_TACTIC_DWELL_MS,
  BOT_TACTIC_EARLY_LAPS,
  BOT_TACTIC_FLYER_LAPS,
  BOT_TACTIC_FLYER_SURGE,
  BOT_TACTIC_FLYER_WBAL_SHARE,
  BOT_TACTIC_FOLLOW_METRES,
  BOT_TACTIC_FOLLOW_SURGE,
  BOT_TACTIC_LAUNCH_METRES,
  BOT_TACTIC_MOVE_SHARE,
  BOT_TACTIC_RECOVER_CP_SHARE,
  BOT_TACTIC_RECOVER_SHARE,
  BOT_TACTIC_UTILITY,
  BOT_TACTIC_WBAL_FLOOR,
  BOT_TACTIC_WHEEL_CLOSING_GAIN,
  BOT_TACTIC_WHEEL_EASE,
  BOT_TACTIC_WHEEL_FLOOR_WATTS,
  BOT_TACTIC_WHEEL_FURTHEST_METRES,
  BOT_TACTIC_WHEEL_GAP_GAIN,
  BOT_TACTIC_WHEEL_GAP_METRES,
  BOT_TACTIC_WHEEL_METRES,
  BOT_TACTIC_WHEEL_NEAREST_METRES,
  BOT_TACTIC_WHEEL_PACE_SHARE,
  BOT_TACTIC_WHEEL_SURGE,
  BOT_TACTICS,
  botLaunchMetres,
  decideTactic,
  TACTIC_MEMORY_AT_START,
} from './tactics';

export type { BotPlanInput, BotPlanStep, BotPlanTactic, BotRacePlan } from './plan';
export {
  BOT_PLAN_SURGE_CEILING,
  BOT_SPRINT_LONGEST_METRES,
  BOT_SPRINT_SHORTEST_METRES,
  BOT_WPRIME_JOULES,
  botPlanStep,
  botRacePlan,
  botWPrimeJoules,
} from './plan';

// Each bot's W′ balance (#2458, ADR 0067 D-2): the discrete differential form,
// in `+ − × ÷` only, so it stays bit-identical across x86 and ARM.
export type { BotCapacity, BotEnergy } from './wbal';
export {
  BOT_CEILING_WATTS,
  BOT_WBAL_REENTRY_FRACTION,
  BOT_WBAL_TICK_TOLERANCE,
  fullBotEnergy,
  spendableWatts,
  stepWbal,
} from './wbal';
