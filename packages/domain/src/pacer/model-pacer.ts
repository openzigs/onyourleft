// SPDX-License-Identifier: Apache-2.0

/**
 * **A language model's direction of the bot pacer: what it is shown, what it
 * may answer, and how its answer is ridden** — #2712, ADR 0072.
 *
 * The rider who chose an AI pacer rides the #92 pacer as it is, with one
 * difference: every few seconds the pacer's **intent** is chosen again and a
 * model on the rider's own instance writes one short line of feedback.
 * Everything else is the pacer it always was — the same 75 kg, the same
 * road, the same `advance` tick in `@onyourleft/physics`.
 *
 * ⚠️ **Since #2835 (ADR 0083) the device decides the intent and the model
 * writes only the line.** `pacer/device-rule.ts` §`pacerRuleDecision` reads
 * the gap and the terrain and picks the intent and how far it goes; the model
 * is told what the pacer is doing and why ({@link PACER_REASONS}) and answers
 * `{"say":<a short line>}`. A failed, late or void answer costs a line, never
 * the pacing.
 *
 * ## What the model is shown
 *
 * {@link ModelPacerInput}: the pacer's advertised W/kg, its plan and intent
 * now and how long it has held the intent, where the rider is against it, the
 * rider's W/kg and whether they are in its draft, the grade ahead, the metres
 * to the finish and the seconds ridden; since #2794, the course ahead
 * ({@link ModelPacerCourse}: the next climb and descent, and the climbing
 * left). **Every field is a number, a boolean
 * or a word from a closed list**, except `recentLines` (#2760): the model's
 * own last lines, screened free text (§`pacerSayProblem`: no digit but a
 * cadence or power target, no symbol, and a length), written by the model from a state that holds no
 * name or place. There is no other field a coordinate, a place name, a rider's name,
 * a date or an identifier could be written into, and
 * {@link readModelPacerInput} refuses any key it does not name. A problem
 * names the field and the rule, never the value (ADR 0004 D).
 *
 * ## What the model may answer
 *
 * `{"say":<a short line>}` and nothing else (#2835). **There is no power
 * field**, no plan, no intent and no number at all (ADR 0072 D-3).
 * {@link readModelPacerAnswer} reads it field by field: a key the schema does
 * not name makes the whole answer invalid, so a model that writes
 * `"watts": 900` or `"intent": "lift"` has said nothing; so does text that
 * is not JSON, an answer longer than {@link MODEL_PACER_ANSWER_MOST_CHARACTERS}
 * or a line that fails {@link pacerSayProblem}. An invalid answer is a line
 * not shown; the pacer rides what the device decided.
 *
 * ## How an answer is ridden
 *
 * {@link directedPacingFactor}: the plan says how the pacer's power follows
 * the grade, the intent lifts or eases it by {@link PacerDirection.by}, and
 * **the product is held inside #92's own envelope**,
 * {@link PACING_FACTOR_FLOOR} to {@link PACING_FACTOR_CEILING} of the flat
 * figure. In the first {@link PACER_START_RAMP_S} of a directed ride it is
 * ramped up from the rider's own effort ({@link pacerStartShare},
 * {@link PacerDirection.startFrom}), which may be below the envelope (ADR
 * 0092 D-1); past it, it surges and recovers ({@link pacerSurgeAt}). A surge,
 * and nothing else, may take it above the envelope, to
 * {@link PACER_SURGE_CEILING} for at most {@link PACER_SURGE_HELD_MOST_S}
 * (ADR 0092 D-4): the plan and the intent together stay at
 * {@link PACING_FACTOR_CEILING}. Past the ramp nothing takes the pacer below
 * the envelope's floor, and nothing names a power. The pacer's power never reaches a trainer (ADR 0072 D-6): it moves
 * the pacer, and the pacer gives a draft only as a rider riding harder does.
 *
 * ## Replay
 *
 * The pacer's power is a function of its plan, the grade, the decision in
 * force and the seconds ridden, and nothing else: {@link pacerDirectionAt}
 * reads the decision in force at a time off the stored log, start ramp
 * included. So a directed ride's pacer replays from
 * the route, the plan, the log, and the position and wind its speed is ridden
 * in, under {@link MODEL_PACER_CODE_VERSION} — all stored with the ride
 * (`@onyourleft/store` §`PacerModelFact`, #2712's review), with where the
 * ride began on the recording's clock.
 */

import { HEART_RATE_ZONE_NAMES, POWER_ZONE_NAMES } from '../analysis/zones';
import type { GradePercent, Watts } from '../quantities';
import { isCourseHill, type CourseHill } from '../route/course-ahead';
import { watts } from '../quantities';
import {
  flatPowerWatts,
  PACING_FACTOR_CEILING,
  PACING_FACTOR_FLOOR,
  pacingFactor,
  type BotPacerPlan,
} from './pacing';

/**
 * How the pacer's power follows the road — the model's **plan** (ADR 0072 D-2):
 *
 * - `rolling`: #92's own rule, {@link pacingFactor}: a little harder up, easier down;
 * - `even`: the flat figure whatever the grade, a metronome to sit behind;
 * - `climber`: #92's envelope reached on gentler grades: harder sooner up, easier sooner down.
 */
export const PACER_PLANS = ['rolling', 'even', 'climber'] as const;
export type PacerPlan = (typeof PACER_PLANS)[number];

/**
 * What the pacer does now — the model's **intent** (ADR 0072 D-2): `hold`
 * the plan, `lift` a little above it, or `ease` a little below it.
 */
export const PACER_INTENTS = ['hold', 'lift', 'ease'] as const;
export type PacerIntent = (typeof PACER_INTENTS)[number];

/**
 * A plan and an intent, and how far the intent goes: the whole of what moves
 * the pacer. Since #2835 (ADR 0083) the device chooses it, never a model.
 */
export interface PacerDirection {
  readonly plan: PacerPlan;
  readonly intent: PacerIntent;
  /**
   * The share of the plan's power the intent lifts or eases by (#2835): 0 to
   * {@link PACER_CHASE_MOST} for `lift`, 0 to {@link PACER_WAIT_MOST} for
   * `ease`, in whole hundredths. Absent, the fixed {@link PACER_LIFT} or
   * {@link PACER_EASE}: the terrain rule's, and every log from before #2835.
   * Nothing for `hold`.
   */
  readonly by?: number;
  /**
   * How far through the start ramp the ride is, 0 to 1 (#2835,
   * {@link pacerStartShare}). **Never stored**: {@link pacerAsRidden} sets it
   * from the seconds ridden, live and on replay alike. Absent past the ramp.
   */
  readonly startShare?: number;
  /**
   * Where the start ramp begins, as a share of the pacer's flat figure: the
   * rider's own W/kg over the pacer's ({@link pacerStartFrom}), so the pacer
   * starts at the rider's speed (the owner's ruling of 2026-11-20). **Stored**
   * with each decision of the ramp, since it reads the rider; absent past it,
   * and in a log from before the ruling, where the ramp begins at
   * {@link PACING_FACTOR_FLOOR}.
   */
  readonly startFrom?: number;
  /**
   * How far the pacer is surging (above 0) or recovering (below 0) about its
   * target, as a share of it ({@link pacerSurgeAt}, the owner's ruling of
   * 2026-11-20). **Never stored**: {@link pacerAsRidden} sets it from the
   * seconds ridden. Absent where it is nothing.
   */
  readonly surge?: number;
}

/** How much `lift` raises the plan's power with no {@link PacerDirection.by}: **5 %**. A feel parameter, the author's choice. */
export const PACER_LIFT = 0.05;

/** How much `ease` lowers it with no {@link PacerDirection.by}: **7 %**. Easing is the larger, as #92's envelope is. */
export const PACER_EASE = 0.07;

/**
 * The most the pacer eases to wait for a rider behind it: **20 %**, the whole
 * of #92's envelope below the flat figure (`1 − PACING_FACTOR_FLOOR`). #2835.
 */
export const PACER_WAIT_MOST = 0.2;

/**
 * The most it lifts to chase a rider ahead of it: **10 %**, the whole of the
 * envelope above the flat figure (`PACING_FACTOR_CEILING − 1`). #2835.
 */
export const PACER_CHASE_MOST = 0.1;

/**
 * How long the start ramp lasts, seconds ridden: **30**. #2835 made it 60
 * from the bottom of the envelope; the owner's tablet ride of 2026-11-20 found
 * the pacer 28.6 s up the road 5 s in, and ruled *"The pacer starts alongside
 * the rider at the rider's speed and builds to its target over about 30 s"*.
 */
export const PACER_START_RAMP_S = 30;

/**
 * How far through the start ramp a ride `riddenS` seconds old is: `riddenS /
 * 30`, from 0 at the start, or `undefined` once the ramp is over (and for a
 * time that is not one). **The curve is linear in power**: under a direction
 * the pacer rides `from + (target − from) × share` of its flat figure, where
 * `from` is {@link PacerDirection.startFrom} — the rider's own effort — and
 * `target` what the direction asks at this grade ({@link directedPacingFactor}).
 * So it starts riding as hard as the rider, and reaches its target at exactly
 * {@link PACER_START_RAMP_S}, without a step.
 */
export function pacerStartShare(riddenS: number): number | undefined {
  if (!(riddenS >= 0) || riddenS >= PACER_START_RAMP_S) return undefined;
  return riddenS / PACER_START_RAMP_S;
}

/**
 * Where the start ramp begins for a rider at `riderWPerKg` behind a pacer of
 * `pacerWPerKg`: the rider's W/kg over the pacer's, in hundredths, held to `0`
 * and {@link PACING_FACTOR_CEILING} (the owner's ruling of 2026-11-20). At the
 * same W/kg the pacer, at its 75 kg, rides about the rider's speed. With no
 * live power, `0`: a rider who is not pedalling is not left behind.
 */
export function pacerStartFrom(
  riderWPerKg: number | null | undefined,
  pacerWPerKg: number,
): number {
  if (riderWPerKg === null || riderWPerKg === undefined || !Number.isFinite(riderWPerKg)) return 0;
  if (!(pacerWPerKg > 0)) return 0;
  const share = Math.min(PACING_FACTOR_CEILING, Math.max(0, riderWPerKg / pacerWPerKg));
  return Math.round(share * 100) / 100;
}

/**
 * **The pacer's surges and recoveries** — the owner's ruling of 2026-11-20:
 * *"have a power range and be able to push almost like a real person would do
 * then pull back"*. A share of the pacer's target, above 0 a surge and below
 * it a recovery, as a function of the seconds ridden and nothing else, so it
 * replays from the log as the ramp does.
 *
 * Past the start ramp the ride is cut into {@link PACER_SURGE_WINDOW_S}
 * windows. In each, a fixed hash of the window's number (seeded by
 * {@link PACER_SURGE_SEED}) picks one of four: no surge, or a surge of
 * {@link PACER_SURGE_LEAST} to {@link PACER_SURGE_MOST} held for
 * {@link PACER_SURGE_HELD_LEAST_S} to {@link PACER_SURGE_HELD_MOST_S}, then a recovery of half that depth for as long. Each begins
 * {@link PACER_SURGE_LEAD_S} into its window and every edge is a
 * {@link PACER_SURGE_EDGE_S} slope, so the power never steps. Deterministic:
 * the same second gives the same share on every ride and every replay.
 */
export function pacerSurgeAt(riddenS: number): number {
  if (!Number.isFinite(riddenS) || riddenS < PACER_START_RAMP_S) return 0;
  const since = riddenS - PACER_START_RAMP_S;
  const window = Math.floor(since / PACER_SURGE_WINDOW_S);
  const into = since - window * PACER_SURGE_WINDOW_S;
  const roll = surgeHash(window);
  // One window in four rides steady: a person does not surge every minute.
  if (roll % 4 === 0) return 0;
  const depth =
    PACER_SURGE_LEAST + (((roll >>> 2) % 101) / 100) * (PACER_SURGE_MOST - PACER_SURGE_LEAST);
  const held =
    PACER_SURGE_HELD_LEAST_S +
    ((roll >>> 9) % (PACER_SURGE_HELD_MOST_S - PACER_SURGE_HELD_LEAST_S + 1));
  const surge = plateau(into, PACER_SURGE_LEAD_S, PACER_SURGE_LEAD_S + held);
  const recover = plateau(into, PACER_SURGE_LEAD_S + held, PACER_SURGE_LEAD_S + 2 * held);
  return Math.round((depth * surge - (depth / 2) * recover) * 10_000) / 10_000;
}

/** The surge pattern's window, seconds ridden: **45**. A feel parameter. */
export const PACER_SURGE_WINDOW_S = 45;
/** Seconds into a window before its surge begins: **5**. */
export const PACER_SURGE_LEAD_S = 5;
/** Seconds each edge of a surge or a recovery takes: **2**, so the power never steps. */
export const PACER_SURGE_EDGE_S = 2;
/** The least a surge goes above the target: **4 %**. */
export const PACER_SURGE_LEAST = 0.04;
/**
 * The most: **8 %**. A recovery goes half as far below it. On a target at the
 * top of #92's envelope a surge may go above it, to {@link PACER_SURGE_CEILING}.
 */
export const PACER_SURGE_MOST = 0.08;
/** The shortest a surge is held, seconds: **8**. */
export const PACER_SURGE_HELD_LEAST_S = 8;
/**
 * The longest a surge is held, seconds: **15**, edges included — the owner's
 * second ruling of 2026-11-20, *"a surge on its own may reach 115 % of the
 * target for at most 15 s"* (ADR 0092 D-4). So the pacer is above
 * {@link PACING_FACTOR_CEILING} for 15 s at the most at a time, and a
 * recovery follows every surge.
 */
export const PACER_SURGE_HELD_MOST_S = 15;
/**
 * The most a surge may take the pacer to, as a multiplier of its flat figure:
 * **115 %** (the owner's second ruling of 2026-11-20, ADR 0092 D-4). Only a
 * surge: the plan and the intent, the chase among them, are held to
 * {@link PACING_FACTOR_CEILING} before the surge is applied.
 */
export const PACER_SURGE_CEILING = 1.15;
/** The surge pattern's fixed seed. Changing it changes every ride's pacer: a code-version change. */
export const PACER_SURGE_SEED = 0x2835_1120;

/** 1 inside `[from, to]`, 0 outside, with an {@link PACER_SURGE_EDGE_S} slope at each end. */
function plateau(at: number, from: number, to: number): number {
  if (at <= from || at >= to) return 0;
  return Math.min(1, (at - from) / PACER_SURGE_EDGE_S, (to - at) / PACER_SURGE_EDGE_S);
}

/** A 32-bit integer hash of `window` under {@link PACER_SURGE_SEED} (a murmur3 finaliser). */
function surgeHash(window: number): number {
  let h = (PACER_SURGE_SEED ^ Math.imul(window + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * `direction` as it is ridden at `riddenS` seconds, live and on replay by this
 * one function: inside the start ramp with its share; past it with the
 * surge or recovery of {@link pacerSurgeAt}, unless it is easing — a pacer
 * waiting for a rider does not surge away from them. The same object where
 * neither applies.
 */
export function pacerAsRidden(direction: PacerDirection, riddenS: number): PacerDirection {
  const startShare = pacerStartShare(riddenS);
  if (startShare !== undefined) return { ...direction, startShare };
  if (direction.intent === 'ease') return direction;
  const surge = pacerSurgeAt(riddenS);
  return surge === 0 ? direction : { ...direction, surge };
}

/** The grade at which the `climber` plan is at the top of the envelope: **4 %**, half #92's 8 %. */
export const CLIMBER_CLIMB_GRADE_PERCENT = 4;

/** The grade at which the `climber` plan is at the bottom: **−3 %**, half #92's −6 %. */
export const CLIMBER_DESCENT_GRADE_PERCENT = 3;

/** Hold `value` inside #92's envelope. */
function inEnvelope(value: number): number {
  return Math.min(PACING_FACTOR_CEILING, Math.max(PACING_FACTOR_FLOOR, value));
}

/** The plan's own factor at `grade`, before the intent. */
function planFactor(plan: PacerPlan, grade: number): number {
  switch (plan) {
    case 'rolling':
      return pacingFactor(grade);
    case 'even':
      return 1;
    case 'climber': {
      if (!Number.isFinite(grade)) return 1;
      if (grade >= 0) {
        return 1 + Math.min(grade / CLIMBER_CLIMB_GRADE_PERCENT, 1) * (PACING_FACTOR_CEILING - 1);
      }
      return 1 - Math.min(-grade / CLIMBER_DESCENT_GRADE_PERCENT, 1) * (1 - PACING_FACTOR_FLOOR);
    }
  }
}

/** A share inside `[0, most]`, or `fallback` for one that is absent or not a number. */
function shareWithin(by: number | undefined, most: number, fallback: number): number {
  return by === undefined || !Number.isFinite(by) ? fallback : Math.min(most, Math.max(0, by));
}

/** The intent's multiplier: by {@link PacerDirection.by}, or the fixed share with none. */
function intentFactor(direction: PacerDirection): number {
  switch (direction.intent) {
    case 'hold':
      return 1;
    case 'lift':
      return 1 + shareWithin(direction.by, PACER_CHASE_MOST, PACER_LIFT);
    case 'ease':
      return 1 - shareWithin(direction.by, PACER_WAIT_MOST, PACER_EASE);
  }
}

/**
 * The multiplier a direction applies to the flat figure at `grade`: the
 * plan's factor times the intent's, **held inside #92's envelope**; then the
 * surge or recovery, if any, held to {@link PACING_FACTOR_FLOOR} and
 * {@link PACER_SURGE_CEILING} (ADR 0092 D-4), so only a surge is ever above
 * the envelope; and inside the start ramp brought up from where the ramp
 * begins ({@link pacerStartShare}). With `{rolling, hold}` and no ramp it is
 * {@link pacingFactor} exactly.
 */
export function directedPacingFactor(
  direction: PacerDirection,
  grade: GradePercent | number,
): number {
  const value: number = grade;
  const { startShare, startFrom, surge } = direction;
  // The plan and the intent, the chase among them, never above the envelope.
  const directed = inEnvelope(planFactor(direction.plan, value) * intentFactor(direction));
  const target =
    surge === undefined || !Number.isFinite(surge)
      ? directed
      : Math.min(
          PACER_SURGE_CEILING,
          Math.max(
            PACING_FACTOR_FLOOR,
            directed * (1 + Math.min(PACER_SURGE_MOST, Math.max(-PACER_SURGE_MOST / 2, surge))),
          ),
        );
  if (startShare === undefined || !Number.isFinite(startShare)) return target;
  const share = Math.min(1, Math.max(0, startShare));
  // The owner's ruling of 2026-11-20: from the rider's own effort, which may
  // be below the envelope's floor, as a rider pulling away from the line is.
  const from =
    startFrom === undefined || !Number.isFinite(startFrom)
      ? PACING_FACTOR_FLOOR
      : Math.min(PACING_FACTOR_CEILING, Math.max(0, startFrom));
  return from + (target - from) * share;
}

/**
 * What the pacer pedals at this grade under `direction`: the flat figure of
 * its plan times {@link directedPacingFactor}. With no direction, #92's
 * `pacedPowerWatts` is the rule, and this is never called.
 */
export function directedPowerWatts(
  plan: BotPacerPlan,
  grade: GradePercent | number,
  direction: PacerDirection,
): Watts {
  return watts(flatPowerWatts(plan) * directedPacingFactor(direction, grade));
}

// --- What the model is shown -----------------------------------------------

/** The pacer and the rider as the model is shown them at one instant. */
export interface ModelPacerInput {
  /** The pacer's advertised W/kg, the rider's choice. */
  readonly pacerWPerKg: number;
  /** The plan and intent the pacer rides now: since #2835 what the device just decided. */
  readonly plan: PacerPlan;
  readonly intent: PacerIntent;
  /** Whole seconds it has held {@link intent}. */
  readonly secondsInIntent: number;
  /** Why the device chose {@link intent} (#2835): a word from {@link PACER_REASONS}. */
  readonly reason: PacerReason;
  /** How far the intent goes, whole percent of the pacer's power: 0 to 20 (#2835). */
  readonly byPct: number;
  /** Whether the pacer is still easing itself in over the first {@link PACER_START_RAMP_S} (#2835). */
  readonly starting: boolean;
  /** Metres the rider is ahead of the pacer; below 0, behind it. */
  readonly riderGapM: number;
  /** The rider's W/kg now, or `null` with no live power. */
  readonly riderWPerKg: number | null;
  /** Whether the rider is in the pacer's draft now. */
  readonly riderInDraft: boolean;
  /** The grade 100 m up the road from the pacer, percent. */
  readonly gradeAheadPct: number;
  /** Metres from the pacer to the route's end, or `null` on a loop. */
  readonly toFinishM: number | null;
  /** Whole seconds ridden. */
  readonly rideS: number;
  // --- #2760: the rider's own sensors. Each is ABSENT when the sensor is not live. ---
  /** The rider's W/kg over the last 3 s, as the HUD shows it. */
  readonly rider3sWPerKg?: number;
  /** The rider's average W/kg over the last minute of riding. */
  readonly riderMinuteWPerKg?: number;
  /** The zone of the 3 s power, of the rider's own threshold, by its name (`POWER_ZONE_NAMES`); absent with none set. */
  readonly powerZone?: string;
  /** Whether power is rising, steady or fading over the last minute. */
  readonly powerTrend?: PacerPowerTrend;
  /** Whole seconds power has stayed at or above the rider's own threshold, unbroken, until now. */
  readonly aboveThresholdS?: number;
  /** Cadence now, whole revolutions a minute. */
  readonly cadenceRpm?: number;
  /** Heart rate now, whole beats a minute. */
  readonly heartRateBpm?: number;
  /** The zone of the heart rate, of the rider's own threshold heart rate, by its name (`HEART_RATE_ZONE_NAMES`); absent with none set. */
  readonly heartRateZone?: string;
  /** Whether heart rate is rising, steady or falling over the last minute. */
  readonly heartRateTrend?: PacerHeartRateTrend;
  /**
   * The model's own last lines this ride, oldest first, so it does not say
   * them again: at most {@link MODEL_PACER_RECENT_LINES}, each one that
   * {@link pacerSayProblem} passed. Absent before the first. Held in memory
   * on the device for the ride and never stored (ADR 0072 D-4.4).
   */
  readonly recentLines?: readonly string[];
  // --- #2777: where the rider is, in words a model cannot read backwards. ---
  /**
   * Where the rider is against the pacer, by the time gap at the rider's own
   * speed ({@link riderPlaceOf}): `ahead` or `behind` by more than
   * {@link PACER_LEVEL_S}, else `level`. Absent at a standstill.
   */
  readonly riderPlace?: RiderPlace;
  /**
   * How the gap moved since the last ask ({@link gapTrendOf}), for the rider:
   * `rider-gaining` (pulling away, or coming back), `steady`, or
   * `rider-losing` (dropping back, or being caught). Absent on the first ask.
   */
  readonly gapTrend?: PacerGapTrend;
  /**
   * The road ahead of the pacer (#2794): the next climb and descent, and the
   * climbing left. Optional, so a device from before it still asks; every
   * device since sends it.
   */
  readonly course?: ModelPacerCourse;
  // --- #2835: more to coach from. Numbers only, each absent when it cannot be said. ---
  /** The time gap, seconds at the rider's own speed, to a tenth: above 0 the rider is ahead. Absent at a standstill. */
  readonly gapS?: number;
  /** Whole seconds the rider has been at {@link riderPlace} without a break. */
  readonly placeForS?: number;
  /** Metres the rider gained on the pacer (below 0, lost) over about the last 30 s. Absent in a ride's first 30 s. */
  readonly gapDriftM?: number;
  /** The last half-minute's mean power against the half-minute before, whole percent: below 0, fading. */
  readonly powerDriftPct?: number;
  /** The same for cadence, whole rpm, from the readings of the last minute's decisions. */
  readonly cadenceDriftRpm?: number;
  /** The same for heart rate, whole bpm. Effort, never a health reading. */
  readonly heartRateDriftBpm?: number;
}

/**
 * **Why the device chose the pacer's intent** (#2835, ADR 0083 D-1), which is
 * also what the model is told and what the log keeps. A closed list:
 *
 * - `rider-level`: the rider is with the pacer, so it holds;
 * - `rider-behind`: the rider has dropped back, so it eases to wait;
 * - `rider-ahead`: the rider has pulled away, so it lifts to chase;
 * - `rider-stopped`: the rider is at a standstill behind it, so it eases as far as it may;
 * - `before-climb`, `descent`, `over-the-top`: ADR 0082's terrain rule, with
 *   the rider level or in the draft.
 */
export const PACER_REASONS = [
  'rider-level',
  'rider-behind',
  'rider-ahead',
  'rider-stopped',
  'before-climb',
  'descent',
  'over-the-top',
] as const;
export type PacerReason = (typeof PACER_REASONS)[number];

/**
 * **The course ahead of the pacer**, as the model is shown it (#2794), from
 * `route/course-ahead.ts`. Metres to 10 m, grades to a whole percent.
 */
export interface ModelPacerCourse {
  /** The next climb (at least 3 % for at least 200 m, within 5 km and before the finish), or `null`. */
  readonly climb: CourseHill | null;
  /** The next descent, by the same rule downhill, or `null`. */
  readonly descent: CourseHill | null;
  /** On a loop, metres to the end of this lap; `null` on a route with a finish (`toFinishM`). */
  readonly lapLeftM: number | null;
  /** Metres of climbing left to the finish, or on a loop to the end of the lap. */
  readonly climbLeftM: number;
}

/** Where the rider is against the pacer. A closed list (#2777). */
export const RIDER_PLACES = ['ahead', 'level', 'behind'] as const;
export type RiderPlace = (typeof RIDER_PLACES)[number];

/** How the gap moved, for the rider. A closed list (#2777). */
export const PACER_GAP_TRENDS = ['rider-gaining', 'steady', 'rider-losing'] as const;
export type PacerGapTrend = (typeof PACER_GAP_TRENDS)[number];

/**
 * The time gap inside which the rider is `level` with the pacer: **2 s** at
 * the rider's own speed, either way — a rider in the draft, or about to be.
 * A feel parameter, the author's choice (#2777).
 */
export const PACER_LEVEL_S = 2;

/**
 * The rate the gap must move at to count as gained or lost: **0.2 m/s**,
 * about 2 % of a 36 km/h ride. Slower than that is `steady`. The author's
 * choice (#2777).
 */
export const PACER_GAP_TREND_METRES_PER_SECOND = 0.2;

/**
 * Where a rider `riderGapM` metres ahead of the pacer (below 0, behind) is,
 * at `riderSpeed` m/s: `undefined` at a standstill, where a time gap is a
 * division by zero (`pacer/gap.ts`).
 */
export function riderPlaceOf(riderGapM: number, riderSpeed: number): RiderPlace | undefined {
  if (!(riderSpeed > 0) || !Number.isFinite(riderGapM) || !Number.isFinite(riderSpeed)) {
    return undefined;
  }
  const gapSeconds = riderGapM / riderSpeed;
  if (gapSeconds > PACER_LEVEL_S) return 'ahead';
  if (gapSeconds < -PACER_LEVEL_S) return 'behind';
  return 'level';
}

/** One reading of the gap: the seconds ridden, and the metres the rider is ahead. */
export interface PacerGapReading {
  readonly atS: number;
  readonly riderGapM: number;
}

/**
 * How the gap moved from `earlier` to `later`, for the rider, or `undefined`
 * when no time passed between them.
 */
export function gapTrendOf(
  earlier: PacerGapReading,
  later: PacerGapReading,
): PacerGapTrend | undefined {
  const elapsed = later.atS - earlier.atS;
  if (!(elapsed > 0)) return undefined;
  const rate = (later.riderGapM - earlier.riderGapM) / elapsed;
  if (!Number.isFinite(rate)) return undefined;
  if (rate > PACER_GAP_TREND_METRES_PER_SECOND) return 'rider-gaining';
  if (rate < -PACER_GAP_TREND_METRES_PER_SECOND) return 'rider-losing';
  return 'steady';
}

/** How power moved over the last minute. A closed list. */
export const PACER_POWER_TRENDS = ['rising', 'steady', 'fading'] as const;
export type PacerPowerTrend = (typeof PACER_POWER_TRENDS)[number];

/** How heart rate moved over the last minute. A closed list. */
export const PACER_HEART_RATE_TRENDS = ['rising', 'steady', 'falling'] as const;
export type PacerHeartRateTrend = (typeof PACER_HEART_RATE_TRENDS)[number];

/** How many of its own last lines the model is shown: **3**. */
export const MODEL_PACER_RECENT_LINES = 3;

/** A state refused: the field, and the rule it broke. Never the value. */
export interface ModelPacerInputProblem {
  readonly field: string;
  readonly problem: string;
}

export type ModelPacerInputRead =
  | { readonly ok: true; readonly value: ModelPacerInput }
  | { readonly ok: false; readonly problem: ModelPacerInputProblem };

/**
 * The longest pacer state accepted, characters of its JSON: **2 048**. One
 * with every sensor and three lines is about 615; 1 024 until #2760 widened it.
 */
export const MODEL_PACER_INPUT_MOST_CHARACTERS = 2_048;

const INPUT_KEYS = [
  'pacerWPerKg',
  'plan',
  'intent',
  'secondsInIntent',
  'riderGapM',
  'riderWPerKg',
  'riderInDraft',
  'gradeAheadPct',
  'toFinishM',
  'rideS',
  // #2835: a state from before the device decided carries none of these, and is refused.
  'reason',
  'byPct',
  'starting',
] as const;

/** The fields a state may leave out: each a sensor the rider may not have (#2760). */
const OPTIONAL_INPUT_KEYS = [
  'rider3sWPerKg',
  'riderMinuteWPerKg',
  'powerZone',
  'powerTrend',
  'aboveThresholdS',
  'cadenceRpm',
  'heartRateBpm',
  'heartRateZone',
  'heartRateTrend',
  'recentLines',
  'riderPlace',
  'gapTrend',
  'course',
  'gapS',
  'placeForS',
  'gapDriftM',
  'powerDriftPct',
  'cadenceDriftRpm',
  'heartRateDriftBpm',
] as const;

const KNOWN_INPUT_KEYS: readonly string[] = [...INPUT_KEYS, ...OPTIONAL_INPUT_KEYS];

/** The highest cadence a state may say, rpm: well over any rider's. */
const MOST_CADENCE_RPM = 250;
/** The heart rates a state may say, bpm: wider than any rider's. */
const LEAST_HEART_RATE_BPM = 20;
const MOST_HEART_RATE_BPM = 250;

/** The largest distance a state may say, metres: a route of 1 000 km. */
const MOST_METRES = 1_000_000;
/** The most seconds a state may say: a day. */
const MOST_SECONDS = 86_400;
/** The highest W/kg a state may say: well over any rider's. */
const MOST_WATTS_PER_KILOGRAM = 40;
/** The most a state may say the intent moves the pacer by, whole percent: {@link PACER_WAIT_MOST}. */
const MOST_BY_PERCENT = 20;
/** The largest drift a state may say, percent: ten times over. */
const MOST_DRIFT = 1_000;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const numberIn = (value: unknown, least: number, most: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= least && value <= most;

const wholeIn = (value: unknown, least: number, most: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= least && value <= most;

const oneOf = (list: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && list.includes(value);

/**
 * Read a pacer state a device sent: exactly {@link ModelPacerInput}'s shape
 * and no more than {@link MODEL_PACER_INPUT_MOST_CHARACTERS} of JSON, or the
 * first problem, naming the field and never the value.
 */
export function readModelPacerInput(value: unknown): ModelPacerInputRead {
  const refuse = (field: string, problem: string): ModelPacerInputRead => ({
    ok: false,
    problem: { field, problem },
  });
  if (!isRecord(value)) return refuse('input', 'must be an object');
  if (JSON.stringify(value).length > MODEL_PACER_INPUT_MOST_CHARACTERS) {
    return refuse(
      'input',
      `must be at most ${String(MODEL_PACER_INPUT_MOST_CHARACTERS)} characters`,
    );
  }
  if (Object.keys(value).some((key) => !KNOWN_INPUT_KEYS.includes(key))) {
    return refuse('input', 'has a field this pacer state does not');
  }
  const missing = INPUT_KEYS.find((key) => !(key in value));
  if (missing !== undefined) return refuse(`input.${missing}`, 'is required');
  const checks: readonly (readonly [string, boolean, string])[] = [
    [
      'pacerWPerKg',
      numberIn(value.pacerWPerKg, 0, MOST_WATTS_PER_KILOGRAM),
      'must be watts per kilogram',
    ],
    ['plan', oneOf(PACER_PLANS, value.plan), 'must be one of the three plans'],
    ['intent', oneOf(PACER_INTENTS, value.intent), 'must be one of the three intents'],
    [
      'secondsInIntent',
      wholeIn(value.secondsInIntent, 0, MOST_SECONDS),
      'must be a whole number of seconds',
    ],
    ['riderGapM', numberIn(value.riderGapM, -MOST_METRES, MOST_METRES), 'must be metres'],
    [
      'riderWPerKg',
      value.riderWPerKg === null || numberIn(value.riderWPerKg, 0, MOST_WATTS_PER_KILOGRAM),
      'must be watts per kilogram, or null',
    ],
    ['riderInDraft', typeof value.riderInDraft === 'boolean', 'must be a boolean'],
    ['gradeAheadPct', numberIn(value.gradeAheadPct, -100, 100), 'must be a grade in percent'],
    [
      'toFinishM',
      value.toFinishM === null || numberIn(value.toFinishM, 0, MOST_METRES),
      'must be metres, or null',
    ],
    ['rideS', wholeIn(value.rideS, 0, MOST_SECONDS), 'must be a whole number of seconds'],
    ['reason', oneOf(PACER_REASONS, value.reason), 'must be one of the pacer’s reasons'],
    [
      'byPct',
      wholeIn(value.byPct, 0, MOST_BY_PERCENT),
      'must be a whole percent the pacer may move by',
    ],
    ['starting', typeof value.starting === 'boolean', 'must be a boolean'],
  ];
  const failed = checks.find(([, ok]) => !ok);
  if (failed !== undefined) return refuse(`input.${failed[0]}`, failed[2]);
  // #2760: a sensor field is absent or valid; `null` is not "absent".
  const sensorChecks: readonly (readonly [string, (field: unknown) => boolean, string])[] = [
    ['rider3sWPerKg', (v) => numberIn(v, 0, MOST_WATTS_PER_KILOGRAM), 'must be watts per kilogram'],
    [
      'riderMinuteWPerKg',
      (v) => numberIn(v, 0, MOST_WATTS_PER_KILOGRAM),
      'must be watts per kilogram',
    ],
    ['powerZone', (v) => oneOf(POWER_ZONE_NAMES, v), 'must be one of the power zones'],
    ['powerTrend', (v) => oneOf(PACER_POWER_TRENDS, v), 'must be one of the three trends'],
    ['aboveThresholdS', (v) => wholeIn(v, 0, MOST_SECONDS), 'must be a whole number of seconds'],
    ['cadenceRpm', (v) => wholeIn(v, 0, MOST_CADENCE_RPM), 'must be whole revolutions a minute'],
    [
      'heartRateBpm',
      (v) => wholeIn(v, LEAST_HEART_RATE_BPM, MOST_HEART_RATE_BPM),
      'must be whole beats a minute',
    ],
    [
      'heartRateZone',
      (v) => oneOf(HEART_RATE_ZONE_NAMES, v),
      'must be one of the heart-rate zones',
    ],
    ['heartRateTrend', (v) => oneOf(PACER_HEART_RATE_TRENDS, v), 'must be one of the three trends'],
    ['recentLines', recentLinesOk, 'must be up to three lines the pacer may say'],
    ['riderPlace', (v) => oneOf(RIDER_PLACES, v), 'must be one of the three places'],
    ['gapTrend', (v) => oneOf(PACER_GAP_TRENDS, v), 'must be one of the three trends'],
    ['course', courseOk, 'must be the course ahead: two hills or null, and metres'],
    ['gapS', (v) => numberIn(v, -MOST_SECONDS, MOST_SECONDS), 'must be seconds'],
    ['placeForS', (v) => wholeIn(v, 0, MOST_SECONDS), 'must be a whole number of seconds'],
    ['gapDriftM', (v) => numberIn(v, -MOST_METRES, MOST_METRES), 'must be metres'],
    ['powerDriftPct', (v) => wholeIn(v, -MOST_DRIFT, MOST_DRIFT), 'must be a whole percent'],
    [
      'cadenceDriftRpm',
      (v) => wholeIn(v, -MOST_CADENCE_RPM, MOST_CADENCE_RPM),
      'must be whole revolutions a minute',
    ],
    [
      'heartRateDriftBpm',
      (v) => wholeIn(v, -MOST_HEART_RATE_BPM, MOST_HEART_RATE_BPM),
      'must be whole beats a minute',
    ],
  ];
  const sensorFailed = sensorChecks.find(([key, ok]) => key in value && !ok(value[key]));
  if (sensorFailed !== undefined) return refuse(`input.${sensorFailed[0]}`, sensorFailed[2]);
  return { ok: true, value: value as unknown as ModelPacerInput };
}

/** Exactly {@link ModelPacerCourse}'s shape, every number in range (#2794). */
function courseOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).sort().join() !== 'climb,climbLeftM,descent,lapLeftM') return false;
  return (
    (value.climb === null || isCourseHill(value.climb)) &&
    (value.descent === null || isCourseHill(value.descent)) &&
    (value.lapLeftM === null || numberIn(value.lapLeftM, 0, MOST_METRES)) &&
    numberIn(value.climbLeftM, 0, MOST_METRES)
  );
}

/** One to {@link MODEL_PACER_RECENT_LINES} lines, each non-empty and one the screen passes. */
function recentLinesOk(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MODEL_PACER_RECENT_LINES &&
    value.every(
      (line: unknown) =>
        typeof line === 'string' && line !== '' && pacerSayProblem(line) === undefined,
    )
  );
}

// --- What the model may answer ---------------------------------------------

/** The longest answer read, characters: **512**. A whole answer is under 150. */
export const MODEL_PACER_ANSWER_MOST_CHARACTERS = 512;

/**
 * The longest line of feedback shown, characters: **80** (ADR 0072 D-4). One
 * line on the ride screen, read at a glance on a handlebar.
 */
export const MODEL_PACER_SAY_MOST_CHARACTERS = 80;

/** Why a line of feedback is refused. A closed list. */
export type PacerSayProblem =
  'too-long' | 'not-a-line' | 'markup' | 'number' | 'trademark' | 'health-claim' | 'no-words';

/** A control character or a line break: a line is one line. */
const NOT_A_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
/** Markup, code, a link or an address: none of it is a sentence. */
const MARKUP = /[<>{}[\]`*_#|\\~^=@/$%&+]|:\/\/|\bwww\./i;
/**
 * A digit of any script, once the cadence and power figures are taken out
 * ({@link CADENCE_OR_POWER}). No other number: so no heart rate, time,
 * distance, speed, zone or share the pacer could be read as asking the rider
 * to hold, and no coordinate (CLAUDE.md §6) — the input holds none, and this
 * makes it impossible rather than unlikely.
 */
const NUMBER = /\p{N}/u;
/**
 * A number written as a number form — a letter-like numeral (`\p{Nl}`) or a
 * Roman numeral, U+2160 to U+2188 — read before NFKC, which turns `Ⅳ` into
 * the letters `IV` that {@link NUMBER} cannot see.
 */
const NUMBER_FORM = /[\p{Nl}\u2160-\u2188]/u;
/** A zone named by a bare Roman numeral in ASCII letters: `zone IV`. */
const ZONE_NUMERAL = /\bzones?\s+[ivxlcdm]+\b/i;
/**
 * Words for a quantity that is not a cadence or a power. A line that carries
 * an admitted figure may name none of them, so the figure is admitted only in
 * a cadence or power sentence: `Heart rate 150 W` is refused.
 */
const OTHER_QUANTITY =
  /\b(?:heart\s*rates?|bpm|pulses?|minutes?|seconds?|km|miles?|(?:kilo)?met(?:re|er)s?|hours?|zones?)\b|%/i;
/**
 * The one kind of figure a line may carry (ADR 0077, the owner's ruling of
 * 2026-11-17): a cadence or a power target, its number in ASCII digits
 * (after NFKC) **immediately followed by its unit**, with one space allowed —
 * `rpm`, `watt`/`watts`, `W` or `W/kg`. No sign, no thousands separator, no
 * range and no other digit may touch it — a sign of any script, so no
 * dash (`\p{Pd}`) and no mathematical symbol (`\p{Sm}`: `−`, `±`, `+`) — and
 * nothing but a non-letter may follow the unit. {@link plausible} then bounds the value; an implausible
 * one leaves its number behind, so the line is refused as a number.
 */
const CADENCE_OR_POWER =
  /(?<![\p{L}\p{N}\p{Pd}\p{Sm}.,])(\d+(?:\.\d+)?) ?(rpm|watts?|W\/kg|W)(?![\p{L}\p{N}/])/giu;
/**
 * The values a cadence or power target may name, inclusive (ADR 0077 D-1):
 * cadence 30 to 150 rpm and power 30 to 2 000 W, in whole numbers; 0.5 to 10
 * W/kg, with at most one decimal place. No leading zero.
 */
function plausible(value: string, unit: string): boolean {
  const perKg = unit.toLowerCase() === 'w/kg';
  if (!(perKg ? /^(?:0|[1-9]\d*)(?:\.\d)?$/ : /^[1-9]\d*$/).test(value)) return false;
  const n = Number(value);
  if (perKg) return n >= 0.5 && n <= 10;
  if (unit.toLowerCase() === 'rpm') return n >= 30 && n <= 150;
  return n >= 30 && n <= 2000;
}
/**
 * `visible` with each plausible cadence or power target replaced by a space,
 * and each implausible one by its bare number, which {@link NUMBER} refuses;
 * and whether any figure was admitted.
 */
function withoutCadenceOrPower(visible: string): { rest: string; admitted: boolean } {
  let admitted = false;
  const rest = visible.replace(CADENCE_OR_POWER, (_figure: string, value: string, unit: string) => {
    if (!plausible(value, unit)) return value;
    admitted = true;
    return ' ';
  });
  return { rest, admitted };
}
/**
 * The load-metric trademarks (CLAUDE.md §6, `docs/agents/scope-and-ip.md`):
 * the abbreviations in capitals as words, and the names in any case.
 */
const TRADEMARK_ABBREVIATION = /\b(?:NP|TSS|IF|CTL|ATL|TSB)\b/;
const TRADEMARK_NAME =
  /\b(?:normali[sz]ed\s+power|training\s+stress|intensity\s+factor|(?:chronic|acute)\s+training\s+load)\b/i;
/**
 * Medical wording: ADR 0048 D-12's nine, and the words a coach's line would
 * use to make a health claim. Regular expressions, so a source scan for
 * rendered words does not read the list as text a rider is shown.
 */
const MEDICAL =
  /\b(?:cardiac|heart\s+conditions?|rehab\w*|patients?|therap\w*|safe\s+heart\s+rates?|protect\w*\s+your\s+heart|medical\w*|clinical\w*|doctors?|injur\w*|illness\w*|diseases?|diagnos\w*|symptoms?|pains?|painful|health\w*)\b/i;
/** At least one letter: a line of only punctuation says nothing. */
const A_LETTER = /\p{L}/u;
/** Characters that render as nothing, removed before any rule is read. */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

/**
 * Why `say` may not be shown, or `undefined` when it may. Read with its
 * invisible characters removed, so a zero-width space cannot split a word
 * past the rules. The empty line is allowed: it shows nothing.
 */
export function pacerSayProblem(say: string): PacerSayProblem | undefined {
  if (say.length > MODEL_PACER_SAY_MOST_CHARACTERS) return 'too-long';
  if (say === '') return undefined;
  if (NOT_A_LINE.test(say)) return 'not-a-line';
  const shown = say.replace(INVISIBLE, '');
  const visible = shown.normalize('NFKC');
  const { rest, admitted } = withoutCadenceOrPower(visible);
  if (MARKUP.test(rest)) return 'markup';
  if (NUMBER.test(rest) || NUMBER_FORM.test(shown) || ZONE_NUMERAL.test(visible)) return 'number';
  if (admitted && OTHER_QUANTITY.test(visible)) return 'number';
  if (TRADEMARK_ABBREVIATION.test(visible) || TRADEMARK_NAME.test(visible)) return 'trademark';
  if (MEDICAL.test(visible)) return 'health-claim';
  if (!A_LETTER.test(visible)) return 'no-words';
  return undefined;
}

// --- #2777: the line says what the pacer does --------------------------------

/**
 * The pacer speaking of itself — `I`, `I'm`, `I will`, `let me`, `let's`,
 * `we` — then up to three words before the verb, none a negation and none
 * `you`: so "I'm going to push" is the pacer's promise, and "I see you
 * pushing" and "I won't push" are not.
 */
const SELF = String.raw`\b(?:i|i'm|i am|i'll|i will|i'd|i would|let me|let's|let us|we|we're|we are|we'll|we will|watch me)(?:\s+(?!(?:not|never|cannot|no|you|your)\b)[a-z]+){0,3}?\s+`;
/** What the pacer says when it will push, lift, chase or come past. */
const PUSH_VERB = String.raw`(?:push\w*|lift\w*|chas\w*|attack\w*|surg\w*|accelerat\w*|speed\w*\s+up|pick\w*\s+(?:it\s+up|up|the\s+pace)|ramp\w*\s+(?:it\s+)?up|go(?:ing)?\s+(?:harder|faster)|rid\w*\s+(?:harder|faster)|up\s+the\s+pace|rais\w*\s+the\s+pace|tak\w*\s+over|overtak\w*|pass\w*\s+you|come\s+(?:past|through|round|around)|coming\s+(?:past|through|round|around)|go(?:ing)?\s+past|catch\w*\s+(?:you|up)|reel\w*\s+you|hunt\w*\s+you|clos\w*\s+(?:the\s+gap|you\s+down|in))`;
/** What the pacer says when it is easing, slowing, waiting or letting the rider come back. */
const EASE_VERB = String.raw`(?:eas\w*|slow\w*|back\w*\s+off|sit\w*\s+up|drop\w*\s+back|wait\w*|hold\w*\s+back|soft[-\s]?pedal\w*|tak\w*\s+it\s+easy|go(?:ing)?\s+eas(?:y|ier)|let\w*\s+you\s+(?:catch|come|bridge|get\s+back|close|rejoin|tuck))`;
/** Letting the rider back, said with no subject: only the pacer can mean it. */
const LET_BACK = String.raw`(?:catch\s+(?:me|up)|come\s+back|bridge|get\s+back|close|rejoin|tuck)`;
const PUSHES = new RegExp(
  String.raw`${SELF}${PUSH_VERB}\b|\bhere\s+i\s+come\b|\bcoming\s+(?:past|through|for\s+you|after\s+you)\b|\b(?:chas|reel|hunt)\w*\s+you\b`,
  'u',
);
const EASES = new RegExp(
  String.raw`${SELF}${EASE_VERB}\b|\b(?:so|for)\s+you\s+(?:can|to)\s+${LET_BACK}\b|\blet\w*\s+you\s+${LET_BACK}\b|\bwaiting\s+for\s+you\b`,
  'u',
);

/** The line as the move rules read it: invisible characters out, NFKC, one case, one apostrophe, one space. */
function forMoves(say: string): string {
  return say
    .replace(INVISIBLE, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/\s+/gu, ' ');
}

/** Whether the line says the pacer is easing, slowing, waiting or letting the rider back (#2777). */
export function pacerSaysEasing(say: string): boolean {
  return EASES.test(forMoves(say));
}

/** Whether the line says the pacer will push, lift, chase or come past (#2777). */
export function pacerSaysPushing(say: string): boolean {
  return PUSHES.test(forMoves(say));
}

/** Why an answer was read as no line at all. A closed list. */
export type ModelPacerInvalid =
  'too-long' | 'not-json' | 'not-an-object' | 'unknown-key' | 'bad-say';

/**
 * An answer, read: a line to show (`''` for none), or why it is none. **It
 * carries no direction** (#2835, ADR 0083 D-2): the device has already
 * decided what the pacer does, so nothing a model writes can change it.
 */
export type ModelPacerAnswer =
  | { readonly ok: true; readonly say: string }
  | { readonly ok: false; readonly reason: ModelPacerInvalid };

const ANSWER_KEYS: ReadonlySet<string> = new Set(['say']);

/**
 * The answer's JSON Schema, which a local model server's structured output
 * holds the model to — and which {@link readModelPacerAnswer} checks again,
 * because a schema a server enforces is not one its caller may trust.
 */
export function modelPacerAnswerSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: {
      say: { type: 'string', maxLength: MODEL_PACER_SAY_MOST_CHARACTERS },
    },
    required: ['say'],
    additionalProperties: false,
  };
}

/** Read a model's answer: its line, or why it is none. */
export function readModelPacerAnswer(text: string): ModelPacerAnswer {
  if (text.length > MODEL_PACER_ANSWER_MOST_CHARACTERS) return { ok: false, reason: 'too-long' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'not-an-object' };
  if (Object.keys(parsed).some((key) => !ANSWER_KEYS.has(key))) {
    return { ok: false, reason: 'unknown-key' };
  }
  const { say } = parsed;
  if (typeof say !== 'string' || pacerSayProblem(say) !== undefined) {
    return { ok: false, reason: 'bad-say' };
  }
  return { ok: true, say: say.trim() };
}

/** `say` as {@link pacerSayRepeats} compares it: one case, letters and digits only. */
function wordsOf(say: string): string {
  return say
    .replace(INVISIBLE, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * How many of its last lines the device remembers to refuse a repeat of:
 * **10** (the owner's ruling of 2026-11-20, *"never the same line again soon
 * after"*). With a line at most every {@link MODEL_PACER_SAY_LEAST_S}, that is
 * at least five minutes. Held in memory for the ride and never stored; the
 * model is still sent only the last {@link MODEL_PACER_RECENT_LINES}.
 */
export const MODEL_PACER_REPEAT_MEMORY = 10;

/**
 * The share of words two lines must have in common to be one line said again:
 * **0.6** of the words in either (the owner's ruling of 2026-11-20). So "easing
 * so you can get back on" and "easing a little so you can get back on" are one
 * line; "nice work, keep it steady" and "keep it steady up this climb" are two.
 */
export const PACER_SAY_SAME_SHARE = 0.6;

/** The distinct words of a line, as {@link wordsOf} reads them. */
function wordSetOf(say: string): ReadonlySet<string> {
  const words = wordsOf(say);
  return new Set(words === '' ? [] : words.split(' '));
}

/**
 * Whether `say` is one of `recent` again (#2835): the same words in the same
 * order, whatever the case, spacing or punctuation — or, since the owner's
 * ruling of 2026-11-20, nearly so: at least {@link PACER_SAY_SAME_SHARE} of
 * the words of the two lines together are in both. The device shows such a
 * line as no new line.
 */
export function pacerSayRepeats(say: string, recent: readonly string[]): boolean {
  const words = wordsOf(say);
  if (words === '') return false;
  const these = wordSetOf(say);
  return recent.some((line) => {
    if (wordsOf(line) === words) return true;
    const those = wordSetOf(line);
    let shared = 0;
    for (const word of these) if (those.has(word)) shared += 1;
    const either = these.size + those.size - shared;
    return either > 0 && shared / either >= PACER_SAY_SAME_SHARE;
  });
}

// --- The decision log, and the decision in force -----------------------------

/**
 * Which pacer code a log was ridden under: **3**. Raised by any change that
 * alters the pacer's power for some route, plan and log — the factors above,
 * {@link MODEL_PACER_LAPSE_S}, or how a decision comes into force. A log
 * stored under another version is not replayed (ADR 0072 D-5).
 *
 * **2 since #2835** (ADR 0083 D-5): a decision is the device's and comes into
 * force when it is asked, not when its answer arrives; its intent goes by a
 * share the log keeps; and the first {@link PACER_START_RAMP_S} are ramped.
 * A version 1 log still reads ({@link readPacerDecisionRecord}) and
 * {@link pacerDirectionAt} still rides its records by version 1's rule.
 *
 * **3 since the owner's rulings of 2026-11-20**: the start ramp is 30 s from
 * the rider's own effort ({@link PacerDirection.startFrom}), the pacer surges
 * and recovers ({@link pacerSurgeAt}), and a chase is 5 % at 3 s. A version 2
 * log, from preview builds only, is not replayed under 3 (ADR 0072 D-5).
 */
export const MODEL_PACER_CODE_VERSION = 3;

/**
 * How often the device decides what the pacer does, seconds ridden: **every
 * 5 s** (ADR 0072 D-7's cadence). Since the owner's rulings of 2026-11-20 a
 * decision no longer asks for a line each time ({@link MODEL_PACER_SAY_LEAST_S}).
 */
export const MODEL_PACER_DECIDE_EVERY_S = 5;

/**
 * How often it decides inside the start ramp: **every second**, so the
 * pacer's start follows the rider's own effort closely
 * ({@link PacerDirection.startFrom}).
 */
export const PACER_START_DECIDE_EVERY_S = 1;

/**
 * The least time between two asks for a line, seconds ridden: **30**. The
 * owner's ruling of 2026-11-20: *"Speak much less often (not every ask)"*.
 * A decision between them is logged `unasked`.
 */
export const MODEL_PACER_SAY_LEAST_S = 30;

/**
 * The most: **60**. Between {@link MODEL_PACER_SAY_LEAST_S} and this the
 * device asks only when the reason for what the pacer does has changed since
 * the last ask, so a line has something new to say.
 */
export const MODEL_PACER_SAY_MOST_S = 60;

/** An answer this long after its ask, seconds ridden, is late and never applied: **5 s**. */
export const MODEL_PACER_LATE_S = 5;

/**
 * How long a decision holds, from its arrival, seconds ridden: **15 s**.
 * Past it, with nothing newer in force, the pacer rides #92's own rule.
 */
export const MODEL_PACER_LAPSE_S = 15;

/** How long a line of feedback stays on the screen after it arrives: **8 s**. */
export const MODEL_PACER_SAY_SHOWN_S = 8;

/**
 * The most decisions one ride keeps: **2 000**, every 5 s for over two and a
 * half hours. Past it, nothing more is asked (ADR 0072 D-7: the ride rides #92's rule).
 */
export const MODEL_PACER_LOG_MOST = 2_000;

/**
 * What became of one ask. A closed list (ADR 0071 D-4.2's, with `applied`);
 * since the owner's rulings of 2026-11-20, `unasked` for a decision that asked
 * for no line ({@link MODEL_PACER_SAY_LEAST_S}), which a version 1 log never holds.
 */
export const PACER_DECISION_OUTCOMES = [
  'applied',
  'late',
  'invalid',
  'refused',
  'failed',
  'unasked',
] as const;
export type PacerDecisionOutcome = (typeof PACER_DECISION_OUTCOMES)[number];

/** What became of an ask's line (#2835). A closed list; **the line itself is never kept** (ADR 0072 D-4.4). */
export const PACER_LINE_OUTCOMES = ['shown', 'none', 'repeat', 'against'] as const;
/**
 * - `shown`: a line was shown;
 * - `none`: no answer, a void one, a late one, or the model said nothing;
 * - `repeat`: hidden, the model said one of its last lines again;
 * - `against`: hidden, it said the opposite of what the pacer was doing.
 */
export type PacerLineOutcome = (typeof PACER_LINE_OUTCOMES)[number];

/**
 * One decision of the device's, as the log keeps it since #2835 (ADR 0083
 * D-5): **in force from `askedAtS`**, whatever became of the ask for a line.
 * Numbers and words from closed lists only: no line, and no coordinate.
 */
export interface PacerRuleRecord {
  /** When the device decided, and asked for a line. Seconds ridden. */
  readonly askedAtS: number;
  /** When the line's answer arrived, or `null` for one that never did. */
  readonly arrivedAtS: number | null;
  /** What became of the ask for a line. `applied`: an answer read in time. */
  readonly outcome: PacerDecisionOutcome;
  /** The direction ridden from `askedAtS`. */
  readonly plan: PacerPlan;
  readonly intent: PacerIntent;
  /** {@link PacerDirection.by}, in hundredths; absent where the direction has none. */
  readonly by?: number;
  /** {@link PacerDirection.startFrom}, in hundredths: inside the start ramp only. */
  readonly startFrom?: number;
  /** Which device rule set the intent. */
  readonly reason: PacerReason;
  /** Where the rider was; absent at a standstill. */
  readonly place?: RiderPlace;
  /** The time gap, seconds to a tenth, above 0 with the rider ahead; absent at a standstill. */
  readonly gapS?: number;
  /** What became of the line. */
  readonly line: PacerLineOutcome;
}

/**
 * One ask, as the ride's log keeps it (ADR 0072 D-5): when it was asked and
 * when it was answered, in seconds ridden — the ride's own clock, never a
 * wall clock — and what became of it. Since #2835 every record is a
 * {@link PacerRuleRecord}; the other two shapes are version 1's, where a
 * model's applied answer carried its direction, still read from storage.
 * **No line of feedback is kept**: what the pacer did replays without it.
 */
export type PacerDecisionRecord =
  | PacerRuleRecord
  | {
      readonly askedAtS: number;
      readonly arrivedAtS: number;
      readonly outcome: 'applied';
      readonly plan: PacerPlan;
      readonly intent: PacerIntent;
    }
  | {
      readonly askedAtS: number;
      /** `null` for an ask nothing came back for: failed, refused before arrival, or unreachable. */
      readonly arrivedAtS: number | null;
      readonly outcome: Exclude<PacerDecisionOutcome, 'applied' | 'unasked'>;
    };

/**
 * One record read back from storage, whole or not at all: `undefined` for
 * anything that is not exactly one of {@link PacerDecisionRecord}'s shapes.
 */
export function readPacerDecisionRecord(value: unknown): PacerDecisionRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { askedAtS, arrivedAtS, outcome } = value;
  if (!numberIn(askedAtS, 0, MOST_SECONDS)) return undefined;
  if ('reason' in value) return readPacerRuleRecord(value, askedAtS);
  if (outcome === 'applied') {
    if (Object.keys(value).sort().join() !== 'arrivedAtS,askedAtS,intent,outcome,plan') {
      return undefined;
    }
    if (!numberIn(arrivedAtS, askedAtS, MOST_SECONDS)) return undefined;
    if (!oneOf(PACER_PLANS, value.plan) || !oneOf(PACER_INTENTS, value.intent)) return undefined;
    return {
      askedAtS,
      arrivedAtS,
      outcome,
      plan: value.plan as PacerPlan,
      intent: value.intent as PacerIntent,
    };
  }
  if (!oneOf(PACER_DECISION_OUTCOMES, outcome) || outcome === 'unasked') return undefined;
  if (Object.keys(value).sort().join() !== 'arrivedAtS,askedAtS,outcome') return undefined;
  if (arrivedAtS !== null && !numberIn(arrivedAtS, askedAtS, MOST_SECONDS)) return undefined;
  return {
    askedAtS,
    arrivedAtS,
    outcome: outcome as Exclude<PacerDecisionOutcome, 'applied' | 'unasked'>,
  };
}

const RULE_RECORD_KEYS: ReadonlySet<string> = new Set([
  'askedAtS',
  'arrivedAtS',
  'outcome',
  'plan',
  'intent',
  'by',
  'startFrom',
  'reason',
  'place',
  'gapS',
  'line',
]);

/** A whole number of hundredths inside `[0, most]`. */
const hundredthsIn = (value: unknown, most: number): value is number =>
  numberIn(value, 0, most) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;

/** A {@link PacerRuleRecord} read back from storage, whole or not at all. */
function readPacerRuleRecord(
  value: Readonly<Record<string, unknown>>,
  askedAtS: number,
): PacerRuleRecord | undefined {
  if (Object.keys(value).some((key) => !RULE_RECORD_KEYS.has(key))) return undefined;
  const { arrivedAtS, outcome, plan, intent, by, startFrom, reason, place, gapS, line } = value;
  if (!oneOf(PACER_DECISION_OUTCOMES, outcome)) return undefined;
  if (arrivedAtS === null ? outcome === 'applied' : !numberIn(arrivedAtS, askedAtS, MOST_SECONDS)) {
    return undefined;
  }
  if (!oneOf(PACER_PLANS, plan) || !oneOf(PACER_INTENTS, intent)) return undefined;
  if (!oneOf(PACER_REASONS, reason) || !oneOf(PACER_LINE_OUTCOMES, line)) return undefined;
  if (line === 'shown' && outcome !== 'applied') return undefined;
  if (outcome === 'unasked' && (arrivedAtS !== null || line !== 'none')) return undefined;
  if (startFrom !== undefined && !hundredthsIn(startFrom, PACING_FACTOR_CEILING)) return undefined;
  if (by !== undefined) {
    const most = intent === 'lift' ? PACER_CHASE_MOST : intent === 'ease' ? PACER_WAIT_MOST : -1;
    if (!hundredthsIn(by, most)) return undefined;
  }
  if (place !== undefined && !oneOf(RIDER_PLACES, place)) return undefined;
  if (gapS !== undefined && !numberIn(gapS, -MOST_SECONDS, MOST_SECONDS)) return undefined;
  return {
    askedAtS,
    arrivedAtS: arrivedAtS as number | null,
    outcome: outcome as PacerDecisionOutcome,
    plan: plan as PacerPlan,
    intent: intent as PacerIntent,
    ...(by === undefined ? {} : { by }),
    ...(startFrom === undefined ? {} : { startFrom }),
    reason: reason as PacerReason,
    ...(place === undefined ? {} : { place: place as RiderPlace }),
    ...(gapS === undefined ? {} : { gapS }),
    line: line as PacerLineOutcome,
  };
}

/**
 * What became of an ask for a line whose answer arrived at `arrivedAtS`:
 * `late` past {@link MODEL_PACER_LATE_S}, whatever it said; `invalid` for one
 * that does not read; else `applied`.
 */
export function pacerAskOutcome(
  askedAtS: number,
  arrivedAtS: number,
  answer: ModelPacerAnswer | 'refused' | 'failed',
): PacerDecisionOutcome {
  if (answer === 'refused' || answer === 'failed') return answer;
  if (arrivedAtS - askedAtS > MODEL_PACER_LATE_S) return 'late';
  return answer.ok ? 'applied' : 'invalid';
}

/**
 * The direction in force at `atS` seconds ridden, read off a ride's log, or
 * `undefined` — #92's own rule. The log is oldest first.
 *
 * **A device's decision** ({@link PacerRuleRecord}, #2835) is in force from
 * the first step at or after it was **asked**, whatever became of its line,
 * until a newer one replaces it or {@link MODEL_PACER_LAPSE_S} passes; and
 * it is ridden as {@link pacerAsRidden} says: up the start ramp in the first
 * {@link PACER_START_RAMP_S}, and with its surges past it.
 *
 * **A version 1 record** applies only when `applied`, from its **arrival**,
 * with no ramp and the fixed shares: a ride saved before #2835 replays as it
 * was ridden.
 */
export function pacerDirectionAt(
  log: readonly PacerDecisionRecord[],
  atS: number,
): PacerDirection | undefined {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const record = log[index];
    if (record === undefined) continue;
    if ('reason' in record) {
      if (record.askedAtS > atS) continue;
      if (atS >= record.askedAtS + MODEL_PACER_LAPSE_S) return undefined;
      const { plan, intent, by, startFrom } = record;
      return pacerAsRidden(
        {
          plan,
          intent,
          ...(by === undefined ? {} : { by }),
          ...(startFrom === undefined ? {} : { startFrom }),
        },
        atS,
      );
    }
    if (record.outcome !== 'applied' || record.arrivedAtS > atS) continue;
    return atS < record.arrivedAtS + MODEL_PACER_LAPSE_S
      ? { plan: record.plan, intent: record.intent }
      : undefined;
  }
  return undefined;
}
