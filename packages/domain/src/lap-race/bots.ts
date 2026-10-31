// SPDX-License-Identifier: Apache-2.0

/**
 * The lap race's bots: their tiers and their decisions — #1900, ADR 0060 D-7
 * and D-9.
 *
 * A bot is a racer like any other (D-7.2). Its `effortDistance` comes from
 * its own paced power through the one physics: `@onyourleft/physics`
 * §`stepBotRace`, through §`advanceBot`, the #92 bot pacer. Its `raceOffset`
 * comes from items, under the same rules and the same B as a rider's. This
 * file holds the two halves that are race rules rather than physics.
 *
 * ## A tier is a W/kg, and nothing else
 *
 * {@link BOT_TIER_WATTS_PER_KILOGRAM}: four tiers the rider chooses from, each
 * a target intensity for `pacer/pacing.ts` §`botPacerPlan`. Every tier rides
 * at {@link BOT_MASS_KILOGRAMS}, the #92 bot's fixed 75 kg, so the advertised
 * W/kg is a promise about the bot's speed. **The rider's own declared mass is
 * never read here, and never shown** (ADR 0028 D-3). The numbers are a
 * proposal for the owner, spread from a social pace to a strong club racer's.
 * They sit inside #92's 0.5–7 W/kg envelope.
 *
 * ## ⚠️ Never from a recorded ride (ADR 0007 D4, D-7.1)
 *
 * A bot replays no prior session of any rider. Its inputs are a tier, the
 * pacing rule, the course and a seed. {@link botDecision} reads the race as it
 * stands, meaning who is ahead and behind and in which lane, and nothing
 * stored. This file imports nothing from `ghost/` or `recording/`, and a test
 * reads its imports to hold that.
 *
 * ## No rubber-banding (D-9, the owner's answer to D-14 Q4)
 *
 * A bot's power is its tier's pacing on the road under it, whatever its
 * place. Nothing here returns a power, and {@link botDecision} decides only
 * when to use the held item and which lane to ride. A bot's catch-up comes
 * from the same position-weighted items a rider gets (D-4.3). US 7,278,913
 * claims computer racers with **target ranks**; a bot with a W/kg tier and no
 * target rank is outside it by construction (spike 0030 §3.2).
 *
 * ## The lane rule, in order
 *
 * 1. A puddle ahead in its lane within {@link BOT_PUDDLE_LOOKAHEAD_METRES}:
 *    move to the lane beside it.
 * 2. Holding a gust, with a racer ahead within {@link BOT_AIM_METRES}: move
 *    into that racer's lane.
 * 3. A racer close behind in its lane: move out of it, on
 *    {@link BOT_DODGE} of ticks.
 *
 * ## Decisions are seeded and pure
 *
 * {@link botDecision} is a function of the race state, the bot's id and the
 * race's seed. Its one random number per decision comes from this module's
 * `random.ts` keyed by those, so the same race gives the same decisions, and
 * the race's own item draws are not disturbed by it.
 */

import { BOT_MASS_KILOGRAMS, botPacerPlan, type BotPacerPlan } from '../pacer/pacing';
import { LANE_COUNT, SLIPSTREAM_REACH_METRES, type ItemRaceState, type LapRacer } from './items';
import { nextUnit, raceRandom } from './random';
import { racePosition } from './race';

/** The tiers a rider races against, by key. Names are keys; #1904 brings the words. */
export type BotTier = 'steady' | 'brisk' | 'hard' | 'fierce';

/** Every tier, slowest first. */
export const BOT_TIERS: readonly BotTier[] = ['steady', 'brisk', 'hard', 'fierce'];

/** Each tier's target intensity, in watts per kilogram at {@link BOT_MASS_KILOGRAMS}. */
export const BOT_TIER_WATTS_PER_KILOGRAM: Readonly<Record<BotTier, number>> = {
  steady: 2,
  brisk: 2.8,
  hard: 3.6,
  fierce: 4.4,
};

/** A tier's pacing plan: its W/kg at the bot's fixed mass. */
export function botTierPlan(tier: BotTier): BotPacerPlan {
  return botPacerPlan(BOT_TIER_WATTS_PER_KILOGRAM[tier], BOT_MASS_KILOGRAMS);
}

/** How far ahead in its lane a bot looks for a puddle to ride round. */
export const BOT_PUDDLE_LOOKAHEAD_METRES = 15;

/** How close a racer ahead must be for a bot holding a gust to steer into its lane. */
export const BOT_AIM_METRES = 30;

/** How close a racer behind must be for a bot to drop a puddle on it, or put on a cape. */
export const BOT_THREAT_METRES = 15;

/** The chance that a bot moves out of the lane of a racer close behind it, in a tick. */
export const BOT_DODGE = 0.3;

/** The chance that a bot acts on a held item in a tick where the rule says it may. */
export const BOT_REACTION = 0.6;

/** What a bot asks of the race this tick: inputs, as a rider's client sends (ADR 0060 D-5.4). */
export interface BotDecision {
  readonly use: boolean;
  readonly lane: number;
}

/** One number in `[0, 1)` for this bot at this tick of this race. */
function decisionUnit(seed: number, index: number, atMs: number, draw: number): number {
  const key =
    (seed >>> 0) ^
    Math.imul(index + 1, 0x85eb_ca6b) ^
    Math.imul(Math.floor(atMs) >>> 0, 0xc2b2_ae35) ^
    Math.imul(draw + 1, 0x27d4_eb2f);
  return nextUnit(raceRandom(key)).value;
}

/** The unfinished racer nearest the bot in one direction, and the gap to it. */
function nearest(
  racers: readonly LapRacer[],
  index: number,
  direction: 1 | -1,
): { readonly racer: LapRacer; readonly gap: number } | undefined {
  const own = racePosition((racers[index] as LapRacer).racer);
  let found: { racer: LapRacer; gap: number } | undefined;
  racers.forEach((other, at) => {
    const gap = (racePosition(other.racer) - own) * direction;
    if (at !== index && other.racer.finishedAtMs === null && gap > 0) {
      if (found === undefined || gap < found.gap) found = { racer: other, gap };
    }
  });
  return found;
}

/** The lane beside `lane`, toward the middle, or either side of it by `unit`. */
function besides(lane: number, unit: number): number {
  if (lane <= 0) return 1;
  if (lane >= LANE_COUNT - 1) return LANE_COUNT - 2;
  return unit < 0.5 ? lane - 1 : lane + 1;
}

/**
 * When to use the held item, and which lane to ride, from the race as it
 * stands. A bot that is finished, or not in the race, keeps its lane and uses
 * nothing.
 */
export function botDecision(race: ItemRaceState, botId: string, seed: number): BotDecision {
  const index = race.racers.findIndex((entry) => entry.racer.id === botId);
  const me = race.racers[index];
  if (me === undefined || me.racer.finishedAtMs !== null) {
    return { use: false, lane: me?.lane ?? 0 };
  }
  const steer = decisionUnit(seed, index, race.atMs, 0);
  const react = decisionUnit(seed, index, race.atMs, 1);
  const ahead = nearest(race.racers, index, 1);
  const behind = nearest(race.racers, index, -1);
  const at = racePosition(me.racer);

  const puddleAhead = race.hazards.some(
    (hazard) =>
      hazard.ownerId !== botId &&
      hazard.lane === me.lane &&
      hazard.position > at &&
      hazard.position - at <= BOT_PUDDLE_LOOKAHEAD_METRES,
  );
  const threatened = behind !== undefined && behind.gap <= BOT_THREAT_METRES;
  let lane = me.lane;
  if (puddleAhead) {
    lane = besides(me.lane, steer);
  } else if (me.held === 'crosswind-gust' && ahead !== undefined && ahead.gap <= BOT_AIM_METRES) {
    lane = ahead.racer.lane;
  } else if (threatened && behind.racer.lane === me.lane && steer < BOT_DODGE) {
    // Out of the line a gust from behind would come up.
    lane = besides(me.lane, steer / BOT_DODGE);
  }

  const wants =
    me.held === 'tailwind' ||
    (me.held === 'slipstream' && ahead !== undefined && ahead.gap <= SLIPSTREAM_REACH_METRES) ||
    (me.held === 'puddle' && threatened && behind.racer.lane === lane) ||
    (me.held === 'crosswind-gust' && ahead !== undefined && ahead.racer.lane === lane) ||
    (me.held === 'rain-cape' && threatened);
  return { use: wants && react < BOT_REACTION, lane };
}
