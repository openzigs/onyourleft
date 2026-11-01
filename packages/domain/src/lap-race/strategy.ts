// SPDX-License-Identifier: Apache-2.0

/**
 * The lap race's bots, deciding with a strategy — #1959, ADR 0060 D-5.4, D-7
 * and D-9.
 *
 * `bots.ts` §`botDecision` is the #1900 bot: reactive rules, each on a fixed
 * chance a tick. {@link strategicBotDecision} replaces it in the solo race
 * (`@onyourleft/physics` §`stepBotRace`). It **decides** better, and it
 * changes **no power**: what it returns is a lane and whether to use the held
 * item, the inputs a rider's client sends (D-5.4), and nothing here holds a
 * power, a mass or an effort distance. A bot's power is still its tier's
 * pacing on the road under it, whatever its place (D-9).
 *
 * ## Item timing: what a use is worth, in metres
 *
 * Each tick the bot scores using its held item now as **metres it gains plus
 * metres it takes from others**, the second weighted by its personality's
 * `attack`. The strengths are `items.ts`' own (§`itemStrength`):
 *
 * | Item | Worth now |
 * |---|---|
 * | `tailwind` | its 6 m, or less: what is left below +B once the effects already running have run |
 * | `tow` | its 8 m, the same way, with a racer within `TOW_REACH_METRES` ahead; nothing without one |
 * | `puddle` | 6 m × `attack` for each rival in its lane **about to reach the next pick-up point** ({@link BOT_PUDDLE_REACH_METRES} short of it or nearer), where the puddle would lie |
 * | `crosswind-gust` | 8 m × `attack` for each rival in its lane within `GUST_REACH_METRES` ahead: what the gust hits |
 * | `rain-cape` | the hit it would absorb: 8 m with a rival **lining up** behind it, newly within gust reach behind in the lane it rides or the lane it moves to (a racer lined up behind can follow it across); 4 m for one that was lined up there last tick too, who may hold nothing; 6 m with a rival's puddle in that lane within its puddle look-ahead (`BOT_PUDDLE_LOOKAHEAD_METRES`, or this tick's travel when that is further), 4 m (half a gust) with a rival within `BOT_THREAT_METRES` behind in another lane, and nothing while one is already on |
 *
 * It uses the item when that beats what it **holds the item for**, its
 * personality's `hold` for the item, in metres. So a `crosswind-gust` an
 * `opportunist` holds for 12 m waits for two racers in reach in one lane
 * (16 m), and a leader's `rain-cape` stays held, as a shield, until a hit is
 * coming (D-4.3's front band is mostly tailwinds, puddles and capes).
 *
 * **Near a pick-up point**, within its puddle look-ahead, a held item would
 * draw nothing there, so the hold falls by `skill` × the mean strength of the
 * band the bot would draw in (`items.ts` §`meanStrength`): a skilled bot
 * spends an item to draw a fresh one when the draw is worth more. At the
 * front, whose band's mean is the lowest, a `defensive` leader keeps its cape.
 *
 * **The last lap** holds nothing back, but for a `tailwind`: every other
 * item's hold is 0 there, less the fresh draw. Offsets drift back toward 0
 * (`items.ts` §`OFFSET_DRIFT_METRES_PER_SECOND`), so a gain used early in the
 * lap is gone by the line; a skilled bot keeps its tailwind (a hold of
 * `skill` × 6 m) for the last {@link BOT_FINISH_WINDOW_METRES}, and, with a
 * racer level with it or within `TOW_REACH_METRES` behind, who could tow back
 * past, for the last call. Racers of one tier ride level all race, so that is
 * where most of their races are decided.
 *
 * **The last call**, within {@link BOT_LAST_CALL_METRES} of the line plus two
 * ticks of travel, spends whatever is held, worth something or not, because a
 * held item is worth nothing after the line. No bot crosses the line holding
 * an item it had a tick to use.
 *
 * ## Lanes: a score per lane, and a dwell
 *
 * Each of the lane it rides and the lanes beside it is scored, in the same
 * metres, and it rides the best:
 *
 * - **Hazards**: −6 m × `caution` for each rival's puddle in the lane between
 *   it and the look-ahead: the #1900 bot's (`bots.ts` §"The puddle
 *   look-ahead"), plus `skill` × the pick-up spacing (a quarter lap), so a
 *   crafty bot picks the lane with fewer hazards over the next spacing.
 * - **Exposure**: −8 m × `caution` for a lane with a rival within gust reach
 *   behind in it. Holding or wearing a cape, it keeps the lane it rides
 *   whoever is behind, and puts the cape on when the hit comes; it still does
 *   not move **into** a rival's line, where its cape would go on at once and
 *   be spent before the hit.
 * - **Aim**: holding a gust, +8 m × `attack` × `hunt` for each rival in reach
 *   ahead in the lane, so it steers to the bunch.
 * - **Sit**: holding a puddle, +6 m × `attack` for each rival in the lane about
 *   to reach the next pick-up point: it sits in the lane of the racer behind,
 *   who must then leave the lane or ride through the puddle. **A tow pulls
 *   whatever the lane** (`items.ts`: lanes matter for hits only, D-6.1), so in
 *   this model sitting in a racer's lane makes them choose through the
 *   puddle, not the tow.
 * - **Stay**: +{@link BOT_LANE_STAY_METRES} for the lane it rides, so a tie
 *   keeps it there; a tie between the others goes toward the middle.
 *
 * Having changed lane, it keeps the new one for {@link BOT_LANE_DWELL_MS}, so
 * it does not flap between lanes every tick, whatever a racer behind does.
 * The one thing that cuts the dwell short is a rival's puddle in its lane
 * within its puddle look-ahead: it rides round that rather than into it, so a
 * bot is never seen to change lane into a puddle and fail to change out. Its
 * memory of when it last moved is {@link BotMemory}, which the caller hands
 * back each tick: it is this race's, and nothing stored or recorded (D-7.1).
 *
 * ## Personalities and skill: two axes, neither of them power
 *
 * {@link BOT_PERSONALITY_WEIGHTS}: `aggressive` fires early and hunts lanes,
 * `defensive` keeps its cape and keeps out of trouble, `opportunist` waits for
 * a bunch. {@link botFieldPersonalities} deals a solo race's field a mix of
 * the three from the race's seed. The names are keys: a rider-facing word for
 * any of them comes with #1904's conventions, and the owner approves it.
 *
 * {@link BOT_SKILL_LEVEL}: how well its choices score, from `naive` (0) to
 * `crafty` (1). Below 1, the bot **misjudges** by up to
 * {@link BOT_MISJUDGE_METRES} × {@link BOT_SKILL_MISJUDGEMENT} (all of it
 * when naive, an eighth when canny, none when crafty): each item it holds by an error
 * drawn once for that item, so a naive bot wastes some items and sits on
 * others, and each lane by an error drawn once per {@link BOT_LANE_DWELL_MS}
 * of race time, so it wanders into trouble. It sees hazards only as far
 * ahead as its skill lets it, and weighs a fresh draw and the line only as
 * far as its skill does. No error is drawn per tick, so the bot's judgement
 * does not depend on how often it is asked (the solo race ticks at 50 ms, the
 * tests at 1 s). Strength, the W/kg tier, is chosen separately and is the
 * only thing that sets power. Both axes are fixed when the race starts and
 * never change with the bot's place: nothing here is a difficulty that
 * follows the standings, and nothing is a recorded or archived parameter
 * (spike 0030's reading of D-7 and D-9 holds as it was written).
 *
 * ## What it reads, and what it never does
 *
 * The race as it stands: where each racer is, in which lane, the puddles on
 * the road, its own item, offset and effects, and the course. **Never another
 * racer's held item or cape**, which a rider cannot see either, and never an
 * input before the tick it is sent. It draws nothing from the race's own
 * generator: its numbers come from `random.ts` keyed by the seed, the bot and
 * the item, as `bots.ts`' do. It imports nothing from `ghost/` or
 * `recording/` (`bots.test.ts` reads its imports).
 */

import { BOT_PUDDLE_LOOKAHEAD_METRES, BOT_THREAT_METRES, checkBotInputs } from './bots';
import type { BotDecision } from './bots';
import { LapRaceError } from './errors';
import {
  GUST_REACH_METRES,
  isLane,
  itemStrength,
  LANE_COUNT,
  meanStrength,
  nextPickUpPoint,
  PICK_UP_FRACTIONS,
  positionBand,
  TOW_REACH_METRES,
  type ItemKind,
  type ItemRaceState,
  type LapRacer,
  type PositionBand,
} from './items';
import { nextUnit, raceRandom } from './random';
import { RACE_OFFSET_BOUND_METRES, racePosition, standings } from './race';

/** A bot's way of racing, by key. Names are keys; #1904's conventions bring any words. */
export type BotPersonality = 'aggressive' | 'defensive' | 'opportunist';

/** Every personality, in the order {@link botFieldPersonalities} deals them. */
export const BOT_PERSONALITIES: readonly BotPersonality[] = [
  'aggressive',
  'defensive',
  'opportunist',
];

/** A personality's decision weights, in metres or as multipliers of metres. */
export interface BotWeights {
  /** A metre taken from a rival, against a metre it gains itself: 1 is even. */
  readonly attack: number;
  /** A metre of trouble in a lane (a puddle ahead, a gust's line behind), against a metre gained. */
  readonly caution: number;
  /** How much a gust's targets draw it into their lane: 0 never steers to aim. */
  readonly hunt: number;
  /** What it holds each item for before the last lap: a use must be worth more, in metres. */
  readonly hold: Readonly<Record<ItemKind, number>>;
}

/**
 * Each personality's weights: a proposal for the owner, with the names.
 *
 * - `aggressive`: fires a gust or a puddle at one racer, puts its cape on at
 *   the first racer close behind, steers hardest to aim and minds trouble least.
 * - `defensive`: keeps its cape until a hit is coming, steers half as hard to
 *   aim, and minds trouble most.
 * - `opportunist`: holds its gust for two racers in one lane and its puddle
 *   for two about to reach it; its cape it puts on as readily as `aggressive`.
 */
export const BOT_PERSONALITY_WEIGHTS: Readonly<Record<BotPersonality, BotWeights>> = {
  aggressive: {
    attack: 1.25,
    caution: 0.5,
    hunt: 1,
    hold: { tailwind: 1, tow: 2, puddle: 3, 'crosswind-gust': 4, 'rain-cape': 3 },
  },
  defensive: {
    attack: 0.75,
    caution: 2,
    hunt: 0.5,
    hold: { tailwind: 2, tow: 4, puddle: 4, 'crosswind-gust': 5, 'rain-cape': 5 },
  },
  opportunist: {
    attack: 1,
    caution: 1,
    hunt: 1,
    hold: { tailwind: 2, tow: 4, puddle: 9, 'crosswind-gust': 12, 'rain-cape': 3 },
  },
};

/** How well a bot's choices score, by key: a proposal for the owner, with the names. */
export type BotSkill = 'naive' | 'canny' | 'crafty';

/** Every skill, least first. */
export const BOT_SKILLS: readonly BotSkill[] = ['naive', 'canny', 'crafty'];

/**
 * Each skill's level, from 0 to 1: 1 judges every item and lane exactly, sees
 * a whole pick-up spacing ahead and plans fully for a fresh draw and the line.
 */
export const BOT_SKILL_LEVEL: Readonly<Record<BotSkill, number>> = {
  naive: 0,
  canny: 0.5,
  crafty: 1,
};

/** A bot's two decision axes, chosen apart from its tier. */
export interface BotStrategy {
  readonly personality: BotPersonality;
  readonly skill: BotSkill;
}

/** What a bot remembers between ticks of one race, and nothing else. */
export interface BotMemory {
  /**
   * The ids of the rivals within gust reach behind it in its lane last tick:
   * one not among them is lining up behind it, which is what a hit coming
   * looks like to a rider, who cannot see what a rival holds.
   */
  readonly linedUpIds: readonly string[];
  /** The instant of the tick it last chose a new lane at, or `null` before its first change. */
  readonly laneSinceMs: number | null;
  /**
   * `pickUpsPassed` when it first saw the item it holds, or `null` while it
   * holds none: the key its judgement of that item is drawn by.
   */
  readonly itemSince: number | null;
}

/** A bot's memory on the start line. */
export const BOT_MEMORY_AT_START: BotMemory = Object.freeze({
  laneSinceMs: null,
  itemSince: null,
  linedUpIds: Object.freeze([]),
});

/** A strategic decision: the inputs, and the memory to hand back next tick. */
export interface StrategicBotDecision extends BotDecision {
  readonly memory: BotMemory;
}

/** How long a bot keeps a lane it has moved into before it may move again. */
export const BOT_LANE_DWELL_MS = 2_000;

/** What riding on in its own lane is worth, in metres: a tie between lanes stays put. */
export const BOT_LANE_STAY_METRES = 0.5;

/** How far short of the next pick-up point a rival counts as about to reach it, for a puddle. */
export const BOT_PUDDLE_REACH_METRES = 60;

/** Within this much of the line, plus two ticks of travel, a bot spends whatever it holds. */
export const BOT_LAST_CALL_METRES = 5;

/**
 * How near the line a skilled bot keeps its `tailwind` for: a 4 s effect at a
 * race pace of 10 m/s, so it has run before the line and the drift has had no
 * time to take it back.
 */
export const BOT_FINISH_WINDOW_METRES = 40;

/** The most a `naive` bot misjudges an item or a lane by, in metres: scaled by {@link BOT_SKILL_MISJUDGEMENT}. */
export const BOT_MISJUDGE_METRES = 12;

/**
 * How much of {@link BOT_MISJUDGE_METRES} each skill misjudges by: a proposal
 * for the owner. `canny`'s eighth (1.5 m) is below the 1 m to 3 m gaps
 * between what an item is worth and what a personality holds it for most of
 * the time, so a canny `defensive` leader keeps its cape until the hit in most
 * races and still misjudges some; at half (6 m) it did in 10 of 100.
 */
export const BOT_SKILL_MISJUDGEMENT: Readonly<Record<BotSkill, number>> = {
  naive: 1,
  canny: 0.125,
  crafty: 0,
};

/** Salts, so the field's deal and an item's judgement are not the race generator's own draws. */
const FIELD_SALT = 0x5bd1_e995;
const JUDGEMENT_SALT = 0x68e3_1da4;

/**
 * The personalities of a solo race's `count` bots: the three in turn, from a
 * start the race's seed picks, so any three bots in a row are one of each.
 *
 * @throws {LapRaceError} for a seed that is not a safe whole number, or a
 *   count that is not a whole number of at least zero.
 */
export function botFieldPersonalities(seed: number, count: number): readonly BotPersonality[] {
  raceRandom(seed);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LapRaceError('field-invalid', 'count must be a whole number of at least zero');
  }
  const first = Math.floor(
    nextUnit(raceRandom((seed >>> 0) ^ FIELD_SALT)).value * BOT_PERSONALITIES.length,
  );
  return Array.from(
    { length: count },
    (_, at) => BOT_PERSONALITIES[(first + at) % BOT_PERSONALITIES.length] as BotPersonality,
  );
}

/** One number in `[−1, 1)` for this bot, keyed by `what` and `which`: never the race's own draw. */
function misjudgement(view: View, what: number, which: number): number {
  const key =
    (view.seed >>> 0) ^
    Math.imul(view.index + 1, 0x85eb_ca6b) ^
    Math.imul(what + 1, 0x27d4_eb2f) ^
    Math.imul(which + 1, 0x1656_67b1) ^
    JUDGEMENT_SALT;
  return 2 * nextUnit(raceRandom(key)).value - 1;
}

/** How far the bot misjudges the item it has held since `itemSince`, in metres: 0 when crafty. */
function itemJudgement(view: View, itemSince: number): number {
  return misjudgement(view, 0, itemSince) * view.misjudgeMetres;
}

/**
 * How far the bot misjudges `lane` in this span of {@link BOT_LANE_DWELL_MS},
 * in metres: 0 when crafty. Keyed by the span of time, not the tick, so how
 * often the bot is asked changes nothing.
 */
function laneJudgement(view: View, lane: number): number {
  const span = Math.floor(view.race.atMs / BOT_LANE_DWELL_MS);
  return misjudgement(view, 1 + lane, span) * view.misjudgeMetres;
}

/** The race as one bot reads it this tick. */
interface View {
  readonly race: ItemRaceState;
  /** The race's seed, which the bot's misjudgements are keyed by. */
  readonly seed: number;
  readonly botId: string;
  /** Its place in the field's id order. */
  readonly index: number;
  /** Its skill's level, 0 to 1. */
  readonly level: number;
  /** The most it misjudges an item or a lane by, in metres. */
  readonly misjudgeMetres: number;
  readonly me: LapRacer;
  readonly at: number;
  /** Every other racer still riding. */
  readonly rivals: readonly LapRacer[];
  readonly weights: BotWeights;
  /** How far ahead it looks for a puddle it must ride round now. */
  readonly urgentMetres: number;
  /** How far ahead it counts puddles when it picks a lane. */
  readonly spanMetres: number;
  /** Who was lined up behind it last tick: its memory's. */
  readonly linedUpIds: readonly string[];
}

/** How far `other` is ahead of the bot by drawn distance: below 0 behind. */
function gapTo(view: View, other: LapRacer): number {
  return racePosition(other.racer) - view.at;
}

/**
 * Rivals in `lane` ahead of the bot, within `reach`; with `orLevel`, those
 * level with it too, who are a target the moment they edge ahead.
 */
function aheadIn(view: View, lane: number, reach: number, orLevel = false): number {
  return view.rivals.filter((other) => {
    const gap = gapTo(view, other);
    return other.lane === lane && (gap > 0 || (orLevel && gap === 0)) && gap <= reach;
  }).length;
}

/** The rivals in `lane` behind the bot within `reach`. */
function behindOf(view: View, lane: number, reach: number): readonly LapRacer[] {
  return view.rivals.filter((other) => {
    const gap = -gapTo(view, other);
    return other.lane === lane && gap > 0 && gap <= reach;
  });
}

/** Whether a rival in `lane` is behind the bot within `reach`. */
function behindIn(view: View, lane: number, reach: number): boolean {
  return behindOf(view, lane, reach).length > 0;
}

/** Other racers' puddles, still wet, in `lane` ahead of the bot within `reach`. */
function puddlesIn(view: View, lane: number, reach: number): number {
  return view.race.hazards.filter(
    (hazard) =>
      hazard.ownerId !== view.botId &&
      hazard.untilMs > view.race.atMs &&
      hazard.lane === lane &&
      hazard.position > view.at &&
      hazard.position - view.at <= reach,
  ).length;
}

/** Rivals in `lane` about to reach the next pick-up point, where the bot's puddle would lie. */
function aboutToReach(view: View, lane: number): number {
  const point = nextPickUpPoint(view.race.course, view.at);
  if (point === null) return 0;
  return view.rivals.filter((other) => {
    const short = point - racePosition(other.racer);
    return other.lane === lane && short > 0 && short <= BOT_PUDDLE_REACH_METRES;
  }).length;
}

/** Whether the bot holds or wears a cape, so a hit from behind is covered. */
function shielded(view: View): boolean {
  return (
    view.me.held === 'rain-cape' ||
    (view.me.capeUntilMs !== null && view.me.capeUntilMs > view.race.atMs)
  );
}

/** A lane's score, in metres. See the module note §"Lanes". */
function laneScore(view: View, lane: number): number {
  const { attack, caution, hunt } = view.weights;
  let score = (lane === view.me.lane ? BOT_LANE_STAY_METRES : 0) + laneJudgement(view, lane);
  score -= caution * itemStrength('puddle') * puddlesIn(view, lane, view.spanMetres);
  // A cape covers a hit in the lane it rides, not one it moves into the line of.
  if ((!shielded(view) || lane !== view.me.lane) && behindIn(view, lane, GUST_REACH_METRES)) {
    score -= caution * itemStrength('crosswind-gust');
  }
  if (view.me.held === 'crosswind-gust') {
    score +=
      hunt * attack * itemStrength('crosswind-gust') * aheadIn(view, lane, GUST_REACH_METRES, true);
  } else if (view.me.held === 'puddle') {
    score += attack * itemStrength('puddle') * aboutToReach(view, lane);
  }
  return score;
}

/**
 * The lane to ride this tick: its own while the dwell runs, unless a rival's
 * puddle lies in it within its puddle look-ahead; else the best-scoring.
 */
function chooseLane(view: View, memory: BotMemory): number {
  const own = view.me.lane;
  const dwelling =
    memory.laneSinceMs !== null && view.race.atMs - memory.laneSinceMs < BOT_LANE_DWELL_MS;
  if (dwelling && puddlesIn(view, own, view.urgentMetres) === 0) return own;
  const middle = (LANE_COUNT - 1) / 2;
  // Its own lane first, then toward the middle, then the lower: the first best wins a tie.
  const candidates = [own, own - 1, own + 1]
    .filter(isLane)
    .sort((a, b) =>
      a === own ? -1 : b === own ? 1 : Math.abs(a - middle) - Math.abs(b - middle) || a - b,
    );
  let best = own;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const lane of candidates) {
    const score = laneScore(view, lane);
    if (score > bestScore) {
      best = lane;
      bestScore = score;
    }
  }
  return best;
}

/** What is left below +B once the effects already running on the bot have run, at most `metres`. */
function headroom(view: View, metres: number): number {
  const atMs = view.race.atMs;
  const coming = view.me.effects.reduce(
    (sum, effect) =>
      sum +
      (effect.rateMetresPerSecond * Math.max(0, effect.untilMs - Math.max(atMs, effect.fromMs))) /
        1_000,
    0,
  );
  return Math.max(
    0,
    Math.min(metres, RACE_OFFSET_BOUND_METRES - view.me.racer.raceOffset - coming),
  );
}

/** What using `kind` now, riding `lane`, is worth in metres. See the module note's table. */
function worthNow(view: View, kind: ItemKind, lane: number): number {
  const { attack } = view.weights;
  switch (kind) {
    case 'tailwind':
      return headroom(view, itemStrength(kind));
    case 'tow': {
      const pulled = view.rivals.some((other) => {
        const gap = gapTo(view, other);
        return gap > 0 && gap <= TOW_REACH_METRES;
      });
      return pulled ? headroom(view, itemStrength(kind)) : 0;
    }
    case 'puddle':
      return attack * itemStrength(kind) * aboutToReach(view, lane);
    case 'crosswind-gust':
      return attack * itemStrength(kind) * aheadIn(view, lane, GUST_REACH_METRES);
    case 'rain-cape': {
      if (view.me.capeUntilMs !== null && view.me.capeUntilMs > view.race.atMs) return 0;
      // A rival lined up behind it can follow it into the lane it moves to.
      const lined = [
        ...behindOf(view, lane, GUST_REACH_METRES),
        ...behindOf(view, view.me.lane, GUST_REACH_METRES),
      ];
      if (lined.some((other) => !view.linedUpIds.includes(other.racer.id))) {
        return itemStrength('crosswind-gust');
      }
      if (puddlesIn(view, lane, view.urgentMetres) > 0) return itemStrength('puddle');
      const near = view.rivals.some((other) => {
        const gap = -gapTo(view, other);
        return gap > 0 && gap <= BOT_THREAT_METRES;
      });
      return near || lined.length > 0 ? itemStrength('crosswind-gust') / 2 : 0;
    }
  }
}

/** Whether the line is close enough that whatever is held must go now. */
function lastCall(view: View, travelMetres: number): boolean {
  const { lapLengthMetres, laps } = view.race.course;
  return lapLengthMetres * laps - view.at <= BOT_LAST_CALL_METRES + 2 * travelMetres;
}

/** What the bot holds `kind` for this tick, in metres. See the module note §"Item timing". */
function holdFor(view: View, kind: ItemKind): number {
  const { level } = view;
  const { lapLengthMetres, laps } = view.race.course;
  const nextPoint = nextPickUpPoint(view.race.course, view.at);
  // Near a pick-up point a held item would draw nothing there, so a skilled
  // bot weighs a fresh draw, the mean strength of its band, against keeping it.
  const nearPoint = nextPoint !== null && nextPoint - view.at <= view.urgentMetres;
  const freshDraw = nearPoint ? level * meanStrength(bandOf(view)) : 0;
  if (view.at >= lapLengthMetres * (laps - 1)) {
    // The last lap: nothing is held back, but a tailwind. Kept for the window
    // it holds more at the line than used now, which the drift takes back;
    // and with a racer level or close enough behind to tow back past, it is
    // kept for the last call, too late for an answer.
    if (kind !== 'tailwind') return -freshDraw;
    const outsideWindow = lapLengthMetres * laps - view.at > BOT_FINISH_WINDOW_METRES;
    const answerable = view.rivals.some((other) => {
      const gap = -gapTo(view, other);
      return gap >= 0 && gap <= TOW_REACH_METRES;
    });
    return outsideWindow || answerable ? level * itemStrength(kind) : 0;
  }
  return view.weights.hold[kind] - freshDraw;
}

/** The band the bot would draw in if it rode through a pick-up point now (`items.ts`). */
function bandOf(view: View): PositionBand {
  const order = standings(view.race.racers.map((entry) => entry.racer));
  return positionBand(order.indexOf(view.botId), view.race.racers.length);
}

/**
 * Which lane to ride and whether to use the held item, from the race as it
 * stands, by the bot's strategy. A bot that is finished, or not in the race,
 * keeps its lane, uses nothing and remembers what it did.
 *
 * @param seed - the race's own seed, the one `createItemRace` took.
 * @param travelMetres - how far the bot will ride this tick, as for
 *   `bots.ts` §`botDecision`: its puddle look-ahead and its last call grow with it.
 * @param memory - what this function returned last tick, or
 *   {@link BOT_MEMORY_AT_START} on the line.
 * @throws {LapRaceError} for a seed that is not a safe whole number, or a
 *   travel that is not a finite number of metres of at least zero.
 */
export function strategicBotDecision(
  race: ItemRaceState,
  botId: string,
  seed: number,
  travelMetres: number,
  strategy: BotStrategy,
  memory: BotMemory,
): StrategicBotDecision {
  checkBotInputs(seed, travelMetres);
  const index = race.racers.findIndex((entry) => entry.racer.id === botId);
  const me = race.racers[index];
  if (me === undefined || me.racer.finishedAtMs !== null) {
    return { use: false, lane: me?.lane ?? 0, memory };
  }
  const level = BOT_SKILL_LEVEL[strategy.skill];
  const course = race.course;
  const urgentMetres = Math.max(BOT_PUDDLE_LOOKAHEAD_METRES, travelMetres);
  const view: View = {
    race,
    seed,
    botId,
    index,
    level,
    misjudgeMetres: BOT_MISJUDGE_METRES * BOT_SKILL_MISJUDGEMENT[strategy.skill],
    me,
    at: racePosition(me.racer),
    rivals: race.racers.filter(
      (other, place) => place !== index && other.racer.finishedAtMs === null,
    ),
    weights: BOT_PERSONALITY_WEIGHTS[strategy.personality],
    urgentMetres,
    // A quarter lap: the spacing of `PICK_UP_FRACTIONS`' points.
    spanMetres: urgentMetres + (level * course.lapLengthMetres) / (PICK_UP_FRACTIONS.length + 1),
    linedUpIds: memory.linedUpIds,
  };

  const lane = chooseLane(view, memory);
  const held = me.held;
  const itemSince = held === null ? null : (memory.itemSince ?? me.pickUpsPassed);
  let use = false;
  if (held !== null && itemSince !== null) {
    use =
      lastCall(view, travelMetres) ||
      worthNow(view, held, lane) + itemJudgement(view, itemSince) > holdFor(view, held);
  }
  return {
    use,
    lane,
    memory: {
      laneSinceMs: lane === me.lane ? memory.laneSinceMs : race.atMs,
      itemSince: use ? null : itemSince,
      linedUpIds: behindOf(view, lane, GUST_REACH_METRES).map((other) => other.racer.id),
    },
  };
}
