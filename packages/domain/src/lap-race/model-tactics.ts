// SPDX-License-Identifier: Apache-2.0

/**
 * **A language model's lap-race bot tactics: what it is shown and what it may
 * answer** — #2709, ADR 0071 D-3.
 *
 * Both halves are checked twice: the instance checks the race it is sent
 * before a model sees it, and the answer before it returns it; the device
 * checks the answer again on arrival (ADR 0071 D-3.2). Both read this one
 * module, so the two checks cannot drift apart.
 *
 * ## What the model is shown
 *
 * {@link ModelTacticsInput}: spike 0039's shape (ADR 0071 D-3.4) — seats,
 * styles, ranks, gaps, W′ shares, drafting, current moves, laps and metres to
 * the line, launch distance, grade ahead, the rider's gap, rank and W/kg.
 * **Every field is a number, a boolean, or a word from a closed list**: there
 * is no field a coordinate, a place name, a rider's name, a date or an
 * identifier could be written into as text, and {@link readModelTacticsInput}
 * refuses any key it does not name. A problem names the field and the rule,
 * never the value (ADR 0004 D).
 *
 * ## What the model may answer
 *
 * `{"bots":[{"bot":<seat>,"move":<one of the seven>,"target"?:"rider"|<seat>}]}`
 * and nothing else. **There is no power field**, nor any number but a seat
 * (D-3.1). {@link readModelTacticsAnswer} reads it field by field: a key the
 * schema does not name anywhere makes the whole answer invalid, so a model that
 * writes `"watts": 900` has said nothing; so does a move outside the seven, a
 * seat outside the field, a seat named twice, text that is not JSON, or an
 * answer longer than {@link MODEL_TACTICS_ANSWER_MOST_CHARACTERS} (D-3.2). A
 * bot the answer does not name keeps its seeded move.
 *
 * Written fresh for #2709 (ADR 0071 D-8.7): the spike's AGPL copy under
 * `apps/web/tools/model-tactics-spike/` is not moved.
 */

import { BOT_ARCHETYPES, type BotArchetype } from './archetype';
import { BOT_TACTICS, type BotTactic } from './tactics';

/**
 * The most bots a model race has: **7**, the lap race's own most
 * (`apps/web` §`LAP_RACE_MOST_BOTS`), so seats run 0 to 6.
 */
export const MODEL_TACTICS_MOST_SEATS = 7;

/**
 * The longest answer read, characters: **8 192**, spike 0039's figure (ADR
 * 0071 D-3.2). Seven moves with targets are under 600 characters; anything
 * near this is not a decision.
 */
export const MODEL_TACTICS_ANSWER_MOST_CHARACTERS = 8_192;

/**
 * The longest race state accepted, characters of its JSON: **4 096**. Seven
 * bots' views are about 1 900 characters (spike 0039's ~960 prompt tokens
 * include the system text).
 */
export const MODEL_TACTICS_INPUT_MOST_CHARACTERS = 4_096;

/** The most laps a race state may say: far over the app's ten. */
const MOST_LAPS = 100;
/** The largest distance a race state may say, metres: a loop of 1 000 km. */
const MOST_METRES = 1_000_000;
/** The highest W/kg a race state may say: well over any rider's. */
const MOST_WATTS_PER_KILOGRAM = 40;

/** One bot as the model is shown it. */
export interface ModelTacticsBotView {
  /** The bot's seat, from 0: its place in the ride's bots. */
  readonly bot: number;
  readonly style: BotArchetype;
  /** Its place in the race, from 1. */
  readonly rank: number;
  /** Metres to the racer directly ahead, or `null` when it leads. */
  readonly gapAheadM: number | null;
  /** Metres to the racer directly behind, or `null` when it is last. */
  readonly gapBehindM: number | null;
  /** Its W′ balance as a share of its W′, 0 to 1. */
  readonly wbal: number;
  readonly drafting: boolean;
  /** The move it is riding now. */
  readonly move: BotTactic;
  readonly lapsLeft: number;
  /** Metres to the finish line. */
  readonly toLineM: number;
  /** How far out it launches its sprint, metres. */
  readonly launchM: number;
  /** The grade 50 m up the road, percent. */
  readonly gradeAheadPct: number;
  /** Metres the rider is ahead of the bot, below 0 behind it. */
  readonly riderGapM: number;
}

/** The race as the model is shown it at one instant. */
export interface ModelTacticsInput {
  readonly laps: number;
  /** How many racers are still racing, the rider included. */
  readonly field: number;
  readonly rider: {
    /** The rider's place, from 1; 0 when the rider is not racing. */
    readonly rank: number;
    readonly wPerKg: number | null;
  };
  readonly bots: readonly ModelTacticsBotView[];
}

/** Who a move is aimed at: the rider, or another bot by its seat. */
export type ModelTacticsTarget = 'rider' | number;

/** One bot's move in an answer. */
export interface ModelTacticsMove {
  readonly bot: number;
  readonly move: BotTactic;
  readonly target?: ModelTacticsTarget;
}

/** Why an answer was read as no decision at all. A closed list (ADR 0071 D-4.2's `invalid`). */
export type ModelTacticsInvalid =
  | 'too-long'
  | 'not-json'
  | 'not-an-object'
  | 'unknown-key'
  | 'not-a-list'
  | 'bad-bot'
  | 'duplicate-bot'
  | 'bad-move'
  | 'bad-target';

/** An answer, read. */
export type ModelTacticsAnswer =
  | { readonly ok: true; readonly moves: readonly ModelTacticsMove[] }
  | { readonly ok: false; readonly reason: ModelTacticsInvalid };

/** A race state refused: the field, and the rule it broke. Never the value. */
export interface ModelTacticsInputProblem {
  readonly field: string;
  readonly problem: string;
}

/** A race state, read. */
export type ModelTacticsInputRead =
  | { readonly ok: true; readonly value: ModelTacticsInput }
  | { readonly ok: false; readonly problem: ModelTacticsInputProblem };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The seats an input's bots sit in, in its order. */
export function modelTacticsSeats(input: ModelTacticsInput): readonly number[] {
  return input.bots.map((view) => view.bot);
}

/**
 * The answer's JSON Schema for a field of `seats`, which a local model
 * server's structured output holds the model to — and which
 * {@link readModelTacticsAnswer} checks again, because a schema a server
 * enforces is not one its caller may trust.
 */
export function modelTacticsAnswerSchema(
  seats: readonly number[],
): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: {
      bots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bot: { type: 'integer', enum: [...seats] },
            move: { type: 'string', enum: [...BOT_TACTICS] },
            target: {
              anyOf: [
                { type: 'string', enum: ['rider'] },
                { type: 'integer', enum: [...seats] },
              ],
            },
          },
          required: ['bot', 'move'],
          additionalProperties: false,
        },
      },
    },
    required: ['bots'],
    additionalProperties: false,
  };
}

const ANSWER_KEYS: ReadonlySet<string> = new Set(['bots']);
const MOVE_KEYS: ReadonlySet<string> = new Set(['bot', 'move', 'target']);

/**
 * Read a model's answer for a field of `seats`: every move it names, or why
 * it names none. See the file comment for what makes it invalid.
 */
export function readModelTacticsAnswer(text: string, seats: readonly number[]): ModelTacticsAnswer {
  if (text.length > MODEL_TACTICS_ANSWER_MOST_CHARACTERS) return { ok: false, reason: 'too-long' };
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
  const list = parsed.bots;
  if (!Array.isArray(list)) return { ok: false, reason: 'not-a-list' };
  const field = new Set(seats);
  const isSeat = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && field.has(value);
  const named = new Set<number>();
  const moves: ModelTacticsMove[] = [];
  for (const entry of list as readonly unknown[]) {
    if (!isRecord(entry)) return { ok: false, reason: 'not-an-object' };
    if (Object.keys(entry).some((key) => !MOVE_KEYS.has(key))) {
      return { ok: false, reason: 'unknown-key' };
    }
    const { bot, move, target } = entry;
    if (!isSeat(bot)) return { ok: false, reason: 'bad-bot' };
    if (named.has(bot)) return { ok: false, reason: 'duplicate-bot' };
    named.add(bot);
    if (typeof move !== 'string' || !(BOT_TACTICS as readonly string[]).includes(move)) {
      return { ok: false, reason: 'bad-move' };
    }
    // A `null` target is no target, as an absent one is.
    if (target !== undefined && target !== null && target !== 'rider' && !isSeat(target)) {
      return { ok: false, reason: 'bad-target' };
    }
    moves.push(
      target === undefined || target === null
        ? { bot, move: move as BotTactic }
        : { bot, move: move as BotTactic, target },
    );
  }
  return { ok: true, moves };
}

const VIEW_KEYS = [
  'bot',
  'style',
  'rank',
  'gapAheadM',
  'gapBehindM',
  'wbal',
  'drafting',
  'move',
  'lapsLeft',
  'toLineM',
  'launchM',
  'gradeAheadPct',
  'riderGapM',
] as const;
const INPUT_KEYS = ['laps', 'field', 'rider', 'bots'] as const;
const RIDER_KEYS = ['rank', 'wPerKg'] as const;

const wholeIn = (value: unknown, least: number, most: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= least && value <= most;

const numberIn = (value: unknown, least: number, most: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= least && value <= most;

/** Why `value` is not exactly `keys`: the first key it has that is not one, or the first it lacks. */
function keyProblem(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  at: string,
): ModelTacticsInputProblem | undefined {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra !== undefined) return { field: at, problem: 'has a field this race state does not' };
  const missing = keys.find((key) => !(key in value));
  return missing === undefined ? undefined : { field: `${at}.${missing}`, problem: 'is required' };
}

/** The first problem with one bot's view, at `at`, or `undefined`. */
function viewProblem(view: unknown, at: string): ModelTacticsInputProblem | undefined {
  if (!isRecord(view)) return { field: at, problem: 'must be an object' };
  const keys = keyProblem(view, VIEW_KEYS, at);
  if (keys !== undefined) return keys;
  const metres = (value: unknown): boolean => numberIn(value, -MOST_METRES, MOST_METRES);
  const gap = (value: unknown): boolean => value === null || numberIn(value, 0, MOST_METRES);
  const checks: readonly (readonly [string, boolean, string])[] = [
    ['bot', wholeIn(view.bot, 0, MODEL_TACTICS_MOST_SEATS - 1), 'must be a seat'],
    [
      'style',
      typeof view.style === 'string' && (BOT_ARCHETYPES as readonly string[]).includes(view.style),
      'must be an archetype',
    ],
    ['rank', wholeIn(view.rank, 1, MODEL_TACTICS_MOST_SEATS + 1), 'must be a place in the field'],
    ['gapAheadM', gap(view.gapAheadM), 'must be metres, or null'],
    ['gapBehindM', gap(view.gapBehindM), 'must be metres, or null'],
    ['wbal', numberIn(view.wbal, 0, 1), 'must be a share from 0 to 1'],
    ['drafting', typeof view.drafting === 'boolean', 'must be a boolean'],
    [
      'move',
      typeof view.move === 'string' && (BOT_TACTICS as readonly string[]).includes(view.move),
      'must be one of the seven moves',
    ],
    ['lapsLeft', wholeIn(view.lapsLeft, 0, MOST_LAPS), 'must be a whole number of laps'],
    ['toLineM', metres(view.toLineM), 'must be metres'],
    ['launchM', numberIn(view.launchM, 0, MOST_METRES), 'must be metres'],
    ['gradeAheadPct', numberIn(view.gradeAheadPct, -100, 100), 'must be a grade in percent'],
    ['riderGapM', metres(view.riderGapM), 'must be metres'],
  ];
  const failed = checks.find(([, ok]) => !ok);
  return failed === undefined ? undefined : { field: `${at}.${failed[0]}`, problem: failed[2] };
}

/**
 * Read a race state a device sent, exactly {@link ModelTacticsInput}'s shape
 * and no more than {@link MODEL_TACTICS_INPUT_MOST_CHARACTERS} of JSON: the
 * state, or the first problem, naming the field and never the value.
 */
export function readModelTacticsInput(value: unknown): ModelTacticsInputRead {
  const refuse = (field: string, problem: string): ModelTacticsInputRead => ({
    ok: false,
    problem: { field, problem },
  });
  if (!isRecord(value)) return refuse('input', 'must be an object');
  if (JSON.stringify(value).length > MODEL_TACTICS_INPUT_MOST_CHARACTERS) {
    return refuse(
      'input',
      `must be at most ${String(MODEL_TACTICS_INPUT_MOST_CHARACTERS)} characters`,
    );
  }
  const keys = keyProblem(value, INPUT_KEYS, 'input');
  if (keys !== undefined) return { ok: false, problem: keys };
  if (!wholeIn(value.laps, 1, MOST_LAPS)) return refuse('input.laps', 'must be a number of laps');
  if (!wholeIn(value.field, 1, MODEL_TACTICS_MOST_SEATS + 1)) {
    return refuse('input.field', 'must be how many are racing');
  }
  const rider = value.rider;
  if (!isRecord(rider)) return refuse('input.rider', 'must be an object');
  const riderKeys = keyProblem(rider, RIDER_KEYS, 'input.rider');
  if (riderKeys !== undefined) return { ok: false, problem: riderKeys };
  if (!wholeIn(rider.rank, 0, MODEL_TACTICS_MOST_SEATS + 1)) {
    return refuse('input.rider.rank', 'must be a place in the field, or 0');
  }
  if (rider.wPerKg !== null && !numberIn(rider.wPerKg, 0, MOST_WATTS_PER_KILOGRAM)) {
    return refuse('input.rider.wPerKg', 'must be watts per kilogram, or null');
  }
  const bots = value.bots;
  if (!Array.isArray(bots) || bots.length === 0 || bots.length > MODEL_TACTICS_MOST_SEATS) {
    return refuse('input.bots', `must list 1 to ${String(MODEL_TACTICS_MOST_SEATS)} bots`);
  }
  const seats = new Set<number>();
  for (const [index, view] of (bots as readonly unknown[]).entries()) {
    const problem = viewProblem(view, `input.bots[${String(index)}]`);
    if (problem !== undefined) return { ok: false, problem };
    const seat = (view as ModelTacticsBotView).bot;
    if (seats.has(seat))
      return refuse(`input.bots[${String(index)}].bot`, 'must not repeat a seat');
    seats.add(seat);
  }
  return { ok: true, value: value as unknown as ModelTacticsInput };
}
