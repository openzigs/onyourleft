// SPDX-License-Identifier: Apache-2.0

/**
 * A lap-race bot's race-aware tactics — #2462, under
 * [ADR 0067](../../../../docs/adr/0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md)
 * D-0, D-1 and D-7.
 *
 * Capacity is fixed at the start (#2458, #2459): a CP, a W′ and a peak. Tactics
 * choose **when** to spend W′ and never how much there is. Each bot reads the
 * race as {@link RaceView} sets it out, picks one of seven states by utility,
 * and the state gives a power target that `wbal.ts` §`spendableWatts` has
 * already capped: no state, rank or gap can lift it over the bot's capacity
 * (ADR 0067 D-1.2).
 *
 * ## The states, and the racecraft they encode
 *
 * | State | When | Power target |
 * |---|---|---|
 * | `sit-in` | the default, most of all in the early laps: most mid-race surges come back | it holds the wheel ahead (below) within {@link BOT_TACTIC_WHEEL_METRES}, no harder than its plan rides the road, CP otherwise |
 * | `follow` | the racer ahead, or the rider ahead, is in a move within {@link BOT_TACTIC_FOLLOW_METRES} | it holds the wheel ahead within {@link BOT_TACTIC_WHEEL_METRES}, W′ paying for it, {@link BOT_TACTIC_FOLLOW_SURGE} over CP further back |
 * | `attack` | in a lull, more on a climb (a climber) or early (an attacker), for {@link BOT_TACTIC_ATTACK_MS} at most | {@link BOT_TACTIC_ATTACK_SURGE} over CP |
 * | `chase` | the racer ahead is out of draft reach and within {@link BOT_TACTIC_BRIDGE_METRES} | {@link BOT_TACTIC_CHASE_SURGE} over CP |
 * | `recover` | the bot reads its W′ under {@link BOT_TACTIC_RECOVER_SHARE} | {@link BOT_TACTIC_RECOVER_CP_SHARE} of CP |
 * | `flyer` | the last {@link BOT_TACTIC_FLYER_LAPS} laps, before the launch, with {@link BOT_TACTIC_FLYER_WBAL_SHARE} of W′ or more | {@link BOT_TACTIC_FLYER_SURGE} over CP, until the bot reads its W′ under {@link BOT_TACTIC_FLYER_WBAL_SHARE} (then it sits in) |
 * | `kick` | from its launch distance, {@link BOT_TACTIC_LAUNCH_METRES} times its archetype's sprint factor | its peak |
 *
 * ⚠️ Every threshold is an amateur-coaching number to tune against #2464's
 * harness, not physiology, and a proposal for the owner.
 *
 * ## Holding a wheel (#2542)
 *
 * In `sit-in` and `follow`, a bot within {@link BOT_TACTIC_WHEEL_METRES} of
 * the racer ahead, the rider or a bot, holds its wheel: its target closes or
 * opens the gap toward {@link BOT_TACTIC_WHEEL_GAP_METRES}, in the band
 * {@link BOT_TACTIC_WHEEL_NEAREST_METRES} to {@link BOT_TACTIC_WHEEL_FURTHEST_METRES}
 * a rider sits on a wheel at. It is a feed-forward and a damped correction,
 * each a function of the view as it stands, so the tick rate changes nothing:
 *
 * - **Feed-forward**: {@link RaceView.holdWatts}, the power that holds the
 *   speed of the racer ahead in the bot's own draft on the road under it,
 *   which `@onyourleft/physics` §`stepBotRace` works out through the one
 *   physics. At the gap and at that speed, it is all the bot needs.
 * - **Correction**: {@link BOT_TACTIC_WHEEL_GAP_GAIN} of CP for every metre
 *   it is off the gap, less {@link BOT_TACTIC_WHEEL_CLOSING_GAIN} of CP for
 *   every m/s it closes, so it slows its approach before it reaches the wheel.
 *   Held between {@link BOT_TACTIC_WHEEL_EASE} of CP under the feed-forward
 *   and {@link BOT_TACTIC_WHEEL_SURGE} over it, so a bot 30 m back closes at
 *   a sitting-in effort, never a sprint.
 *
 * **Sitting in, a bot rides a wheel no harder than its own plan rides that
 * road** (`plan.ts` §`botPlanStep`, {@link TacticDecision.wheel}): it climbs
 * with the wheel as its plan climbs, and a wheel that attacks is let go
 * unless the bot chooses to `follow` it. **Following, W′ pays for the wheel**:
 * the capacity has the last word, as for every state, and a following bot
 * that reads its W′ low recovers or, at 0, is held to CP: it lets the wheel go. A wheel ridden at less than
 * {@link BOT_TACTIC_WHEEL_PACE_SHARE} of the bot's CP
 * ({@link RaceView.aheadEffortWatts}) is too slow to hold, and the bot rides
 * its own pace past it. That reads the effort of the racer ahead, not its
 * speed: a rider slowing onto a climb, or picking up speed over the top, is
 * riding no easier, and a bot that read the speed would pass them there. On
 * the wheel, in a draft, the capacity's floor does not apply (ADR 0067 D-1.3,
 * R-10).
 *
 * ## Choice: utility, a commitment bonus and a dwell (Game AI Pro 3 ch. 13)
 *
 * Each state scores from 0 up from response curves over what the bot reads,
 * weighted by its archetype's `archetype.ts` §`BOT_ARCHETYPE_ATTACK_PROPENSITY`.
 * The state it is in gets {@link BOT_TACTIC_COMMITMENT} on top, and it keeps a
 * state for {@link BOT_TACTIC_DWELL_MS} at least, so two close scores do not
 * ping-pong. Two things cut the dwell short: the launch (a bot kicks at its
 * distance, not a dwell later) and its actual W′ under
 * {@link BOT_TACTIC_WBAL_FLOOR} or exhausted, where `attack` and `chase` are not
 * open to it at all (and an exhausted bot's `flyer` is over).
 *
 * ## Once per window (ADR 0067 D-6.3)
 *
 * The state is chosen at the first call in each `archetype.ts`
 * §`BOT_TACTICS_WINDOW_MS` of race time and held for the rest of the window;
 * the skill's misjudgement (`archetype.ts` §`botTacticsMisjudgement`) is drawn
 * for the window too. So the solo race at 50 ms and the tests at 1 s choose
 * the same states from the same views. The power target follows the state on
 * every call, read from the view as it stands.
 *
 * ## Pure, and nowhere near the trainer
 *
 * A function of the view, the archetype, the skill, its memory and the seed.
 * Scalars only, `+ − × ÷`, `Math.min`, `Math.max` (ADR 0067 D-5.2) and `Math.floor`
 * (an addition to D-5.2's list: exact in IEEE 754); it imports nothing from `apps/`, nothing platform-bound and nothing
 * of the trainer (`tactics.test.ts` reads its imports). `@onyourleft/physics`
 * §`stepBotRace` wires it into the race (#2463): one view and one call per
 * racing bot per tick, its target through `plan.ts` §`botPlanStep`.
 */

import {
  BOT_ARCHETYPE_ATTACK_PROPENSITY,
  BOT_ARCHETYPE_SPRINT_FACTOR,
  BOT_TACTICS_WINDOW_MS,
  botTacticsMisjudgement,
  type BotArchetype,
} from './archetype';
import { BOT_MASS_KILOGRAMS } from '../pacer/pacing';
import { LapRaceError } from './errors';
import { BOT_LANE_DWELL_MS, type BotSkill } from './strategy';
import { spendableWatts, type BotCapacity, type BotEnergy } from './wbal';

/** A bot's tactical state, by key. */
export type BotTactic = 'sit-in' | 'follow' | 'attack' | 'chase' | 'recover' | 'flyer' | 'kick';

/** Every state, in the order a tie between scores goes to. */
export const BOT_TACTICS: readonly BotTactic[] = [
  'kick',
  'recover',
  'sit-in',
  'follow',
  'chase',
  'attack',
  'flyer',
];

/**
 * The race as one bot reads it at one instant (ADR 0067 D-0): every distance
 * on **effort distance**, never on drawn distance.
 */
export interface RaceView {
  /** Race time, ms. */
  readonly atMs: number;
  /** The bot's seat in the field, from 0: what its misjudgement is keyed by. */
  readonly botIndex: number;
  /** Its place, 1 for the leader. */
  readonly rank: number;
  /** How many racers are still racing, itself and the rider included. */
  readonly fieldSize: number;
  /** Metres to the racer ahead, or `null` when it leads. */
  readonly gapAheadMetres: number | null;
  /** Metres to the racer behind, or `null` when it is last. */
  readonly gapBehindMetres: number | null;
  /** Whether the racer ahead is in a move: riding over its own critical power, or the rider pushing. */
  readonly aheadInMove: boolean;
  /** Metres the rider is ahead of the bot, below 0 behind it. */
  readonly riderGapMetres: number;
  /** The rider's power, W/kg, or `null` when the race has none to read. */
  readonly riderWattsPerKilogram: number | null;
  /** Laps left, the one it is on counted whole: 1 on the last lap. */
  readonly lapsLeft: number;
  /** Metres of effort distance to the line. */
  readonly metresToLine: number;
  /** The grade ahead, percent: what the road does in the next stretch. */
  readonly gradeAheadPercent: number;
  /**
   * Its own speed less the racer ahead's, m/s: above 0 it is closing (#2542).
   * 0 when it leads.
   */
  readonly closingMetresPerSecond: number;
  /**
   * The power, watts, that holds the speed of the racer ahead in the bot's own
   * draft ({@link draftFactor}) on the road under it, or `null` when it leads
   * (#2542). Worked out by the caller through the one physics.
   */
  readonly holdWatts: number | null;
  /**
   * How hard the racer ahead rides, watts at the bot's mass, as if in the
   * open: its power over its own draft multiplier (#2542). `null` when it
   * leads, or when its power cannot be read (the rider with no live power).
   */
  readonly aheadEffortWatts: number | null;
  /** Its draft multiplier `k` this tick: 1 in the open and with the draft off (#2542). */
  readonly draftFactor: number;
  /** Its W′ balance now. */
  readonly energy: BotEnergy;
  /** Its capacity, fixed for the race: read, never changed. */
  readonly capacity: BotCapacity;
}

/** What a bot's tactics remember between calls of one race: nothing stored, nothing recorded. */
export interface TacticMemory {
  readonly tactic: BotTactic;
  /** When it took up {@link tactic}, ms of race time, or `null` on the line. */
  readonly sinceMs: number | null;
  /** The decision window it last chose in, or `null` before its first choice. */
  readonly window: number | null;
}

/** A bot's tactics on the start line: sitting in, chosen at no time yet. */
export const TACTIC_MEMORY_AT_START: TacticMemory = Object.freeze({
  tactic: 'sit-in',
  sinceMs: null,
  window: null,
});

/** What {@link decideTactic} returns: the state, its power target, and the memory to hand back. */
export interface TacticDecision {
  readonly tactic: BotTactic;
  readonly targetWatts: number;
  /**
   * Whether the target holds a wheel (#2542): already shaped to the road and
   * the draft, so the plan rides it as it is, with no floor in a draft, and,
   * sitting in, no harder than the plan itself rides there.
   */
  readonly wheel: boolean;
  readonly memory: TacticMemory;
}

/** The least a bot holds a state for, ms: twice `strategy.ts` §`BOT_LANE_DWELL_MS`, **4 s**. */
export const BOT_TACTIC_DWELL_MS = 2 * BOT_LANE_DWELL_MS;

/** What the state a bot is in scores on top of its own, so a close rival score does not flip it. */
export const BOT_TACTIC_COMMITMENT = 0.15;

/** The share of its W′ under which a bot reads that it may not `attack` or `chase`: **0.3**. */
export const BOT_TACTIC_WBAL_FLOOR = 0.3;

/** The share of its W′ under which a bot wants to `recover`: **0.5**. */
export const BOT_TACTIC_RECOVER_SHARE = 0.5;

/**
 * Where a bot launches its kick, metres to the line, times its archetype's
 * sprint factor: **300 m**, the far end of the plan's own sprint
 * (`plan.ts` §`BOT_SPRINT_LONGEST_METRES`). #2463 moved it from 200 m once the
 * tactics were wired: at 200 m a bot's W′ paid for a longer kick than it
 * launched, so a naive bot that misread the line early beat a crafty one that
 * read it exactly (67 of 150 seeds against 83 in `lap-race-bot.test.ts`'s
 * skill race), which is ADR 0067 D-7 backwards. At 300 m the crafty bot is
 * ahead in 84 of 150. ⚠️ Still a feel number for #2464's harness.
 */
export const BOT_TACTIC_LAUNCH_METRES = 300;

/** How many laps from the end a `flyer` may go: the last **2**. */
export const BOT_TACTIC_FLYER_LAPS = 2;

/** The share of its W′ a bot must read to go on a `flyer`: **0.6**. */
export const BOT_TACTIC_FLYER_WBAL_SHARE = 0.6;

/** How many laps from the end count as early, where sitting in scores most: more than **5**. */
export const BOT_TACTIC_EARLY_LAPS = 5;

/** How close a mover ahead must be for a bot to `follow` it, metres: **50**. */
export const BOT_TACTIC_FOLLOW_METRES = 50;

/** Within this, metres, a bot is on the wheel ahead: the draft's reach, **30 m** (`physics` §`DRAFT_REACH_METRES`). */
export const BOT_TACTIC_WHEEL_METRES = 30;

/** The nearest a bot holding a wheel sits behind it, metres: **0.3** (#2542). */
export const BOT_TACTIC_WHEEL_NEAREST_METRES = 0.3;

/** The furthest a bot holding a wheel sits behind it, metres: **1** (#2542). */
export const BOT_TACTIC_WHEEL_FURTHEST_METRES = 1;

/** The gap a bot holding a wheel steers for, metres: the middle of the band, **0.65** (#2542). */
export const BOT_TACTIC_WHEEL_GAP_METRES =
  (BOT_TACTIC_WHEEL_NEAREST_METRES + BOT_TACTIC_WHEEL_FURTHEST_METRES) / 2;

/** What a bot holding a wheel adds, as a share of CP, for every metre it is behind the gap: **0.4** (#2542). */
export const BOT_TACTIC_WHEEL_GAP_GAIN = 0.4;

/** What a bot holding a wheel takes off, as a share of CP, for every m/s it closes on it: **2** (#2542). */
export const BOT_TACTIC_WHEEL_CLOSING_GAIN = 2;

/** The most a bot holding a wheel rides over the feed-forward, as a share of CP: **0.15** (#2542). */
export const BOT_TACTIC_WHEEL_SURGE = 0.15;

/** The most a bot holding a wheel eases under the feed-forward, as a share of CP: **0.5** (#2542). */
export const BOT_TACTIC_WHEEL_EASE = 0.5;

/** The least a bot holding a wheel in a draft rides, watts: **0**, it may freewheel (ADR 0067 D-1.3, R-10). */
export const BOT_TACTIC_WHEEL_FLOOR_WATTS = 0;

/**
 * A wheel ridden at less than this share of the bot's CP, as if in the open,
 * is too slow to hold, and the bot rides past it: **0.85** (#2542).
 */
export const BOT_TACTIC_WHEEL_PACE_SHARE = 0.85;

/** The furthest a bot will bridge to the racer ahead alone, metres: **200**. */
export const BOT_TACTIC_BRIDGE_METRES = 200;

/** The grade ahead from which a bot reads a climb, percent: **3**. */
export const BOT_TACTIC_CLIMB_GRADE_PERCENT = 3;

/** How long an attack lasts at most, ms: **20 s**. */
export const BOT_TACTIC_ATTACK_MS = 20_000;

/** How far over its own CP the rider must ride to read as a move, as a share: **0.15**. */
export const BOT_TACTIC_MOVE_SHARE = 0.15;

/** A following bot's surge over CP while the gap is open: **0.15**. */
export const BOT_TACTIC_FOLLOW_SURGE = 0.15;

/** An attacking bot's surge over CP: **0.3**. */
export const BOT_TACTIC_ATTACK_SURGE = 0.3;

/** A chasing bot's surge over CP: **0.15**. */
export const BOT_TACTIC_CHASE_SURGE = 0.15;

/** A bot on a flyer rides this far over CP: **0.1**. */
export const BOT_TACTIC_FLYER_SURGE = 0.1;

/** A recovering bot's target, as a share of CP: **0.85**. */
export const BOT_TACTIC_RECOVER_CP_SHARE = 0.85;

/**
 * The response curves' weights (Game AI Pro 3 ch. 13): each state's utility is
 * built from these and the archetype's attack propensity. ⚠️ Feel numbers for
 * #2464's harness and the owner, chosen so that on the flat in the early laps
 * an attacker attacks off the wheel and a sprinter sits in, and so that the
 * kick and an exhausted bot's recovery outscore everything else.
 */
export const BOT_TACTIC_UTILITY = Object.freeze({
  /** `kick`, from its launch: over every other state, plus its finish propensity. */
  kick: 2,
  /** `recover` while exhausted: over every state but the kick. */
  exhausted: 1.5,
  /** `sit-in`'s floor, what it scores late in the race off any wheel. */
  sitIn: 0.3,
  /** What sitting in adds in the early laps. */
  sitInEarly: 0.25,
  /** What sitting in adds on a wheel, within the draft. */
  sitInWheel: 0.1,
  /** `follow`'s floor, with a mover in reach. */
  follow: 0.5,
  /** What following adds, times the chase propensity. */
  followChase: 0.3,
  /** `chase`'s floor, with a gap to bridge. */
  chase: 0.3,
  /** What chasing adds, times the chase propensity, the nearer the gap the more. */
  chaseReach: 0.5,
  /** `attack`, times its propensity there and the share of W′ it reads. */
  attack: 0.75,
  /** `flyer`, times the early propensity and the share of W′ it reads. */
  flyer: 0.9,
});

const U = BOT_TACTIC_UTILITY;

/** A ramp from 0 at `from` to 1 at `to` (either way round), held at its ends. */
function ramp(value: number, from: number, to: number): number {
  const share = (value - from) / (to - from);
  return Math.min(1, Math.max(0, share));
}

/** What the bot reads this window, its skill's misjudgement added. */
interface Read {
  readonly toLine: number;
  readonly wbalShare: number;
  readonly gapAhead: number | null;
}

function checkView(view: RaceView): void {
  const finite = [
    view.atMs,
    view.metresToLine,
    view.gradeAheadPercent,
    view.riderGapMetres,
    view.closingMetresPerSecond,
  ];
  if (
    finite.some((value) => !Number.isFinite(value)) ||
    view.atMs < 0 ||
    !Number.isSafeInteger(view.lapsLeft) ||
    view.lapsLeft < 0 ||
    !Number.isSafeInteger(view.rank) ||
    view.rank < 1 ||
    !Number.isSafeInteger(view.fieldSize) ||
    view.rank > view.fieldSize ||
    (view.gapAheadMetres !== null && !Number.isFinite(view.gapAheadMetres)) ||
    // #2463: `null` for the last bot, as `gapAheadMetres` is for the leader.
    (view.gapBehindMetres !== null && !Number.isFinite(view.gapBehindMetres)) ||
    (view.riderWattsPerKilogram !== null && !Number.isFinite(view.riderWattsPerKilogram)) ||
    // #2542: a power a physics worked out, and a draft multiplier in (0, 1].
    (view.holdWatts !== null && !Number.isFinite(view.holdWatts)) ||
    (view.aheadEffortWatts !== null && !Number.isFinite(view.aheadEffortWatts)) ||
    !(view.draftFactor > 0 && view.draftFactor <= 1)
  ) {
    throw new LapRaceError(
      'view-out-of-range',
      'a race view has a finite time of at least zero, finite distances, speeds, powers and grade, whole laps and rank, and a draft multiplier in (0, 1]',
    );
  }
}

/** The launch distance of an archetype's kick, metres to the line. */
export function botLaunchMetres(archetype: BotArchetype): number {
  return BOT_TACTIC_LAUNCH_METRES * BOT_ARCHETYPE_SPRINT_FACTOR[archetype];
}

/** Whether the rider, ahead and close, is in a move the bot can see. */
function riderMoving(view: RaceView): boolean {
  const cpPerKilogram = view.capacity.cpWatts / BOT_MASS_KILOGRAMS;
  return (
    view.riderWattsPerKilogram !== null &&
    view.riderGapMetres > 0 &&
    view.riderGapMetres <= BOT_TACTIC_FOLLOW_METRES &&
    view.riderWattsPerKilogram > cpPerKilogram * (1 + BOT_TACTIC_MOVE_SHARE)
  );
}

/**
 * Whether the bot's W′ shuts it out of `attack` and `chase`: under
 * {@link BOT_TACTIC_WBAL_FLOOR} of its W′, or exhausted. Read on its **actual**
 * balance, not what its skill misreads: a floor a naive bot could misjudge its
 * way past would be no floor.
 */
function shut(view: RaceView): boolean {
  const share = view.energy.wbalJoules / view.capacity.wPrimeJoules;
  return share < BOT_TACTIC_WBAL_FLOOR || view.energy.exhausted;
}

/** Each state's score from what the bot reads: 0 where it is not open to the bot. */
function score(
  tactic: BotTactic,
  view: RaceView,
  read: Read,
  archetype: BotArchetype,
  memory: TacticMemory,
): number {
  const propensity = BOT_ARCHETYPE_ATTACK_PROPENSITY[archetype];
  const launch = botLaunchMetres(archetype);
  const spendable = !shut(view);
  const inLaunch = read.toLine <= launch;
  const early = ramp(view.lapsLeft, 1, BOT_TACTIC_EARLY_LAPS);
  switch (tactic) {
    case 'kick':
      return inLaunch ? U.kick + propensity.finish : 0;
    case 'recover':
      return view.energy.exhausted
        ? U.exhausted
        : ramp(read.wbalShare, BOT_TACTIC_RECOVER_SHARE, 0);
    case 'sit-in': {
      const onWheel = read.gapAhead !== null && read.gapAhead <= BOT_TACTIC_WHEEL_METRES;
      return U.sitIn + U.sitInEarly * early + (onWheel ? U.sitInWheel : 0);
    }
    case 'follow': {
      const mover =
        (view.aheadInMove && read.gapAhead !== null && read.gapAhead <= BOT_TACTIC_FOLLOW_METRES) ||
        riderMoving(view);
      return mover && !inLaunch ? U.follow + U.followChase * propensity.chase : 0;
    }
    case 'chase': {
      const gap = read.gapAhead;
      if (!spendable || inLaunch || gap === null) return 0;
      if (gap <= BOT_TACTIC_WHEEL_METRES || gap > BOT_TACTIC_BRIDGE_METRES) return 0;
      // Nearer is likelier; early in the race, half as likely (most surges come back).
      const near = ramp(gap, BOT_TACTIC_BRIDGE_METRES, BOT_TACTIC_WHEEL_METRES);
      return U.chase + U.chaseReach * propensity.chase * near * (1 - early / 2);
    }
    case 'attack': {
      if (!spendable || inLaunch || view.aheadInMove) return 0;
      // An attack lasts its named time and no more.
      if (
        memory.tactic === 'attack' &&
        memory.sinceMs !== null &&
        view.atMs - memory.sinceMs >= BOT_TACTIC_ATTACK_MS
      ) {
        return 0;
      }
      const climbing = view.gradeAheadPercent >= BOT_TACTIC_CLIMB_GRADE_PERCENT;
      const when = climbing ? propensity.climb : propensity.early * early;
      return U.attack * when * read.wbalShare;
    }
    case 'flyer': {
      if (inLaunch || view.lapsLeft > BOT_TACTIC_FLYER_LAPS || view.energy.exhausted) return 0;
      if (read.wbalShare < BOT_TACTIC_FLYER_WBAL_SHARE) return 0;
      return U.flyer * propensity.early * read.wbalShare;
    }
  }
}

/**
 * What holding the wheel ahead asks for, watts (#2542), or `null` with no
 * wheel to hold: nobody within {@link BOT_TACTIC_WHEEL_METRES}, or a wheel too
 * slow to be worth it. The feed-forward and the damped correction of the
 * header, read on the gap as it is, never as the skill misreads it: a bot
 * misjudges when to go, not where a wheel is a metre in front of it.
 */
function wheelWatts(view: RaceView): number | null {
  const gap = view.gapAheadMetres;
  const cp = view.capacity.cpWatts;
  if (gap === null || gap > BOT_TACTIC_WHEEL_METRES) return null;
  if (view.holdWatts === null) return null;
  const effort = view.aheadEffortWatts;
  if (effort !== null && effort < cp * BOT_TACTIC_WHEEL_PACE_SHARE) return null;
  const correction =
    BOT_TACTIC_WHEEL_GAP_GAIN * (gap - BOT_TACTIC_WHEEL_GAP_METRES) -
    BOT_TACTIC_WHEEL_CLOSING_GAIN * view.closingMetresPerSecond;
  return (
    view.holdWatts +
    cp * Math.min(BOT_TACTIC_WHEEL_SURGE, Math.max(-BOT_TACTIC_WHEEL_EASE, correction))
  );
}

/** What a state asks for, watts, before the capacity caps it: the wheel's where it holds one. */
function wanted(tactic: BotTactic, view: RaceView, wheel: number | null): number {
  const cp = view.capacity.cpWatts;
  switch (tactic) {
    case 'sit-in':
      return wheel ?? cp;
    case 'follow':
      return wheel ?? cp * (1 + BOT_TACTIC_FOLLOW_SURGE);
    case 'attack':
      return cp * (1 + BOT_TACTIC_ATTACK_SURGE);
    case 'chase':
      return cp * (1 + BOT_TACTIC_CHASE_SURGE);
    case 'recover':
      return cp * BOT_TACTIC_RECOVER_CP_SHARE;
    case 'flyer':
      return cp * (1 + BOT_TACTIC_FLYER_SURGE);
    case 'kick':
      return view.capacity.peakWatts;
  }
}

/**
 * The bot's tactic for this instant, its power target, whether it holds a
 * wheel, and the memory to hand back. The state is chosen once per `archetype.ts` §`BOT_TACTICS_WINDOW_MS`;
 * the target follows it on every call, through `wbal.ts` §`spendableWatts` over
 * no time, so it is never over the bot's peak, never over CP while it is
 * exhausted and never under its floor. The caller limits it again to what the
 * balance pays for in its own tick.
 *
 * @param seed - the race's own seed, the one `createItemRace` took.
 * @param memory - what this returned last call, or {@link TACTIC_MEMORY_AT_START}.
 * @throws {LapRaceError} `view-out-of-range` for a view that is not a race's,
 *   and as `archetype.ts` §`botTacticsMisjudgement` and `wbal.ts`
 *   §`spendableWatts` for the seed, the seat and the capacity.
 */
export function decideTactic(
  view: RaceView,
  archetype: BotArchetype,
  skill: BotSkill,
  memory: TacticMemory,
  seed: number,
): TacticDecision {
  checkView(view);
  const window = Math.floor(view.atMs / BOT_TACTICS_WINDOW_MS);
  let { tactic } = memory;
  let next = memory;
  if (memory.window !== window) {
    const error = botTacticsMisjudgement(seed, view.botIndex, skill, view.atMs);
    const read: Read = {
      toLine: view.metresToLine + error.lineMetres,
      wbalShare: Math.min(
        1,
        Math.max(0, view.energy.wbalJoules / view.capacity.wPrimeJoules + error.wbalShare),
      ),
      gapAhead: view.gapAheadMetres === null ? null : view.gapAheadMetres + error.gapMetres,
    };
    const scores = BOT_TACTICS.map((each) => score(each, view, read, archetype, memory));
    const current = scores[BOT_TACTICS.indexOf(memory.tactic)] as number;
    const dwelling = memory.sinceMs !== null && view.atMs - memory.sinceMs < BOT_TACTIC_DWELL_MS;
    // Two things end a dwell: the launch, and a W′ that shuts the bot out of
    // the spending state it is in. Nothing else does.
    const shutOut =
      ((memory.tactic === 'attack' || memory.tactic === 'chase') && shut(view)) ||
      (memory.tactic === 'flyer' && view.energy.exhausted);
    const forced = ((scores[0] as number) > 0 && memory.tactic !== 'kick') || shutOut;
    let best = memory.tactic;
    // On the line nothing is committed yet: the first choice is the best score.
    const commitment = memory.sinceMs === null ? 0 : BOT_TACTIC_COMMITMENT;
    let bestScore = shutOut ? 0 : current + commitment;
    if (!dwelling || forced) {
      BOT_TACTICS.forEach((each, at) => {
        const candidate = scores[at] as number;
        if (candidate > bestScore) {
          best = each;
          bestScore = candidate;
        }
      });
    }
    tactic = best;
    next = {
      tactic,
      sinceMs: tactic === memory.tactic ? (memory.sinceMs ?? view.atMs) : view.atMs,
      window,
    };
  }
  const wheel = tactic === 'sit-in' || tactic === 'follow' ? wheelWatts(view) : null;
  // On a wheel in a draft the capacity's floor does not apply (ADR 0067 D-1.3, R-10).
  const floor =
    wheel !== null && view.draftFactor < 1
      ? BOT_TACTIC_WHEEL_FLOOR_WATTS
      : view.capacity.floorWatts;
  const targetWatts = spendableWatts(
    view.capacity,
    view.energy,
    wanted(tactic, view, wheel),
    0,
    floor,
  );
  return { tactic, targetWatts, wheel: wheel !== null, memory: next };
}
