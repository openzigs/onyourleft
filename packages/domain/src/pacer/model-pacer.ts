// SPDX-License-Identifier: Apache-2.0

/**
 * **A language model's direction of the bot pacer: what it is shown, what it
 * may answer, and how its answer is ridden** — #2712, ADR 0072.
 *
 * The rider who chose an AI pacer rides the #92 pacer as it is, with one
 * difference: every few seconds a model on the rider's own instance picks the
 * pacer's **plan** and **intent** from two closed lists, and writes one short
 * line of feedback. Everything else is the pacer it always was — the same
 * 75 kg, the same road, the same `advance` tick in `@onyourleft/physics`.
 *
 * ## What the model is shown
 *
 * {@link ModelPacerInput}: the pacer's advertised W/kg, its plan and intent
 * now and how long it has held the intent, where the rider is against it, the
 * rider's W/kg and whether they are in its draft, the grade ahead, the metres
 * to the finish and the seconds ridden. **Every field is a number, a boolean
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
 * `{"plan":<one of three>,"intent":<one of three>,"say":<a short line>}` and
 * nothing else. **There is no power field**, and no number at all (ADR 0072
 * D-3). {@link readModelPacerAnswer} reads it field by field: a key the schema
 * does not name makes the whole answer invalid, so a model that writes
 * `"watts": 900` has said nothing; so does a plan or intent outside its list,
 * text that is not JSON, an answer longer than
 * {@link MODEL_PACER_ANSWER_MOST_CHARACTERS}, or a line that fails
 * {@link pacerSayProblem}.
 *
 * ## How an answer is ridden
 *
 * {@link directedPacingFactor}: the plan says how the pacer's power follows
 * the grade, the intent lifts or eases it a little, and **the product is held
 * inside #92's own envelope**, {@link PACING_FACTOR_FLOOR} to
 * {@link PACING_FACTOR_CEILING} of the flat figure. A model can choose where
 * inside the envelope the pacer rides; it cannot take it outside, and it
 * never names a power. The pacer's power never reaches a trainer (ADR 0072
 * D-6): it moves the pacer, and the pacer gives a draft only as a rider
 * riding harder does.
 *
 * ## Replay
 *
 * The pacer's power is a function of its plan, the grade and the decision in
 * force, and nothing else: {@link pacerDirectionAt} reads the decision in
 * force at a time off the stored log. So a directed ride's pacer replays from
 * the route, the plan, the log, and the position and wind its speed is ridden
 * in, under {@link MODEL_PACER_CODE_VERSION} — all stored with the ride
 * (`@onyourleft/store` §`PacerModelFact`, #2712's review), with where the
 * ride began on the recording's clock.
 */

import { HEART_RATE_ZONE_NAMES, POWER_ZONE_NAMES } from '../analysis/zones';
import type { GradePercent, Watts } from '../quantities';
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

/** A plan and an intent: the whole of what a model may choose for the pacer. Two words. */
export interface PacerDirection {
  readonly plan: PacerPlan;
  readonly intent: PacerIntent;
}

/** How much `lift` raises the plan's power: **5 %**. A feel parameter, the author's choice. */
export const PACER_LIFT = 0.05;

/** How much `ease` lowers it: **7 %**. Easing is the larger, as #92's envelope is. */
export const PACER_EASE = 0.07;

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

/** The intent's multiplier. */
function intentFactor(intent: PacerIntent): number {
  switch (intent) {
    case 'hold':
      return 1;
    case 'lift':
      return 1 + PACER_LIFT;
    case 'ease':
      return 1 - PACER_EASE;
  }
}

/**
 * The multiplier a direction applies to the flat figure at `grade`: the
 * plan's factor times the intent's, **held inside #92's envelope**. With
 * `{rolling, hold}` it is {@link pacingFactor} exactly.
 */
export function directedPacingFactor(
  direction: PacerDirection,
  grade: GradePercent | number,
): number {
  const value: number = grade;
  return inEnvelope(planFactor(direction.plan, value) * intentFactor(direction.intent));
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
  /** The plan and intent the pacer rides now. */
  readonly plan: PacerPlan;
  readonly intent: PacerIntent;
  /** Whole seconds it has held {@link intent}. */
  readonly secondsInIntent: number;
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
  ];
  const sensorFailed = sensorChecks.find(([key, ok]) => key in value && !ok(value[key]));
  if (sensorFailed !== undefined) return refuse(`input.${sensorFailed[0]}`, sensorFailed[2]);
  return { ok: true, value: value as unknown as ModelPacerInput };
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
 * The one kind of figure a line may carry (ADR 0077, the owner's ruling of
 * 2026-11-17): a cadence or a power target, its number in ASCII digits
 * (after NFKC) **immediately followed by its unit**, with one space allowed —
 * `rpm`, `watt`/`watts`, `W` or `W/kg`. No sign, no thousands separator, no
 * range and no other digit may touch it, and nothing but a non-letter may
 * follow the unit. {@link plausible} then bounds the value; an implausible
 * one leaves its number behind, so the line is refused as a number.
 */
const CADENCE_OR_POWER =
  /(?<![\p{L}\p{N}.,+-])(\d+(?:\.\d+)?) ?(rpm|watts?|W\/kg|W)(?![\p{L}\p{N}/])/giu;
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
 * and each implausible one by its bare number, which {@link NUMBER} refuses.
 */
function withoutCadenceOrPower(visible: string): string {
  return visible.replace(CADENCE_OR_POWER, (_figure: string, value: string, unit: string) =>
    plausible(value, unit) ? ' ' : value,
  );
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
  const visible = say.replace(INVISIBLE, '').normalize('NFKC');
  const rest = withoutCadenceOrPower(visible);
  if (MARKUP.test(rest)) return 'markup';
  if (NUMBER.test(rest)) return 'number';
  if (TRADEMARK_ABBREVIATION.test(visible) || TRADEMARK_NAME.test(visible)) return 'trademark';
  if (MEDICAL.test(visible)) return 'health-claim';
  if (!A_LETTER.test(visible)) return 'no-words';
  return undefined;
}

/** Why an answer was read as no decision at all. A closed list. */
export type ModelPacerInvalid =
  'too-long' | 'not-json' | 'not-an-object' | 'unknown-key' | 'bad-plan' | 'bad-intent' | 'bad-say';

/** An answer, read: a direction and a line to show (`''` for none), or why it is none. */
export type ModelPacerAnswer =
  | { readonly ok: true; readonly direction: PacerDirection; readonly say: string }
  | { readonly ok: false; readonly reason: ModelPacerInvalid };

const ANSWER_KEYS: ReadonlySet<string> = new Set(['plan', 'intent', 'say']);

/**
 * The answer's JSON Schema, which a local model server's structured output
 * holds the model to — and which {@link readModelPacerAnswer} checks again,
 * because a schema a server enforces is not one its caller may trust.
 */
export function modelPacerAnswerSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: {
      plan: { type: 'string', enum: [...PACER_PLANS] },
      intent: { type: 'string', enum: [...PACER_INTENTS] },
      say: { type: 'string', maxLength: MODEL_PACER_SAY_MOST_CHARACTERS },
    },
    required: ['plan', 'intent', 'say'],
    additionalProperties: false,
  };
}

/** Read a model's answer: a direction and its line, or why it is none. */
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
  const { plan, intent, say } = parsed;
  if (!oneOf(PACER_PLANS, plan)) return { ok: false, reason: 'bad-plan' };
  if (!oneOf(PACER_INTENTS, intent)) return { ok: false, reason: 'bad-intent' };
  if (typeof say !== 'string' || pacerSayProblem(say) !== undefined) {
    return { ok: false, reason: 'bad-say' };
  }
  return {
    ok: true,
    direction: { plan: plan as PacerPlan, intent: intent as PacerIntent },
    say: say.trim(),
  };
}

// --- The decision log, and the decision in force -----------------------------

/**
 * Which pacer code a log was ridden under: **1**. Raised by any change that
 * alters the pacer's power for some route, plan and log — the factors above,
 * {@link MODEL_PACER_LAPSE_S}, or how a decision comes into force. A log
 * stored under another version is not replayed (ADR 0072 D-5).
 */
export const MODEL_PACER_CODE_VERSION = 1;

/** How often a directed ride asks, seconds ridden: **every 5 s** (ADR 0072 D-7). */
export const MODEL_PACER_ASK_EVERY_S = 5;

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

/** What became of one ask. A closed list (ADR 0071 D-4.2's, with `applied`). */
export const PACER_DECISION_OUTCOMES = ['applied', 'late', 'invalid', 'refused', 'failed'] as const;
export type PacerDecisionOutcome = (typeof PACER_DECISION_OUTCOMES)[number];

/**
 * One ask, as the ride's log keeps it (ADR 0072 D-5): when it was asked and
 * when it was answered, in seconds ridden — the ride's own clock, never a
 * wall clock — and what became of it. An applied one carries its direction.
 * **No line of feedback is kept**: what the pacer did replays without it.
 */
export type PacerDecisionRecord =
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
      readonly outcome: Exclude<PacerDecisionOutcome, 'applied'>;
    };

/**
 * One record read back from storage, whole or not at all: `undefined` for
 * anything that is not exactly one of {@link PacerDecisionRecord}'s shapes.
 */
export function readPacerDecisionRecord(value: unknown): PacerDecisionRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { askedAtS, arrivedAtS, outcome } = value;
  if (!numberIn(askedAtS, 0, MOST_SECONDS)) return undefined;
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
  if (!oneOf(PACER_DECISION_OUTCOMES, outcome)) return undefined;
  if (Object.keys(value).sort().join() !== 'arrivedAtS,askedAtS,outcome') return undefined;
  if (arrivedAtS !== null && !numberIn(arrivedAtS, askedAtS, MOST_SECONDS)) return undefined;
  return {
    askedAtS,
    arrivedAtS,
    outcome: outcome as Exclude<PacerDecisionOutcome, 'applied'>,
  };
}

/**
 * What an answer that arrived at `arrivedAtS` for an ask at `askedAtS` is
 * logged as: `late` past {@link MODEL_PACER_LATE_S}, whatever it said.
 */
export function pacerDecisionRecord(
  askedAtS: number,
  arrivedAtS: number,
  answer: ModelPacerAnswer | 'refused' | 'failed',
): PacerDecisionRecord {
  if (answer === 'refused' || answer === 'failed') {
    return { askedAtS, arrivedAtS, outcome: answer };
  }
  if (arrivedAtS - askedAtS > MODEL_PACER_LATE_S) return { askedAtS, arrivedAtS, outcome: 'late' };
  if (!answer.ok) return { askedAtS, arrivedAtS, outcome: 'invalid' };
  return { askedAtS, arrivedAtS, outcome: 'applied', ...answer.direction };
}

/**
 * The direction in force at `atS` seconds ridden, read off a ride's log: the
 * latest applied decision that arrived at or before `atS` and has not lapsed,
 * or `undefined` — #92's own rule. A decision applies from the first step
 * at or after its arrival and holds until a newer one replaces it or
 * {@link MODEL_PACER_LAPSE_S} passes. The log is oldest first.
 */
export function pacerDirectionAt(
  log: readonly PacerDecisionRecord[],
  atS: number,
): PacerDirection | undefined {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const record = log[index];
    if (record?.outcome !== 'applied' || record.arrivedAtS > atS) continue;
    return atS < record.arrivedAtS + MODEL_PACER_LAPSE_S
      ? { plan: record.plan, intent: record.intent }
      : undefined;
  }
  return undefined;
}
