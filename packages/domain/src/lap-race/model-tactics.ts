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
 * {@link ModelTacticsInput}: spike 0039's shape (ADR 0071 D-3.4) as ADR 0073
 * D-5 widened it (#2720, #2710) — seats, racing styles dealt from the seed
 * ({@link modelRacingStyles}), how each bot compares
 * with the field on the flat, a climb, a sprint and in punch (#2759, ADR 0076
 * D-4: {@link MODEL_STRENGTH_WORDS}), ranks, gaps, W′ shares
 * and whether a bot is blown, drafting, current moves, laps and metres to the
 * line as each bot misreads it, launch distance, grade ahead, the rider's gap,
 * and the rider's own state: rank, W/kg, who is ahead of them, their gaps and
 * whether they draft. There is no code-computed attack gate (D-5.3).
 * **The course ahead (#2794):** once for the race, from the leading bot, the
 * next climb and the next descent, the lap's metres and climbing left, and
 * the grade of the last 500 m to the line ({@link ModelTacticsCourse}, by
 * `route/course-ahead.ts`'s stated thresholds), so a bot can plan for a hill
 * it cannot yet feel.
 * **Trimmed for latency (#2759, ADR 0076 D-11):** a bot's archetype (its
 * "legs") is not sent, because since ADR 0076 D-3 its racing style decides
 * it, nor the count of racers, which the prompt never reads; the device
 * rounds every gap to whole metres, the grade to a whole percent and a W′
 * share to a tenth.
 * **Every field is a number, a boolean, or a word from a closed list**: there
 * is no field a coordinate, a place name, a rider's name, a date or an
 * identifier could be written into as text, and {@link readModelTacticsInput}
 * refuses any key it does not name. A problem names the field and the rule,
 * never the value (ADR 0004 D).
 *
 * ## What the model may answer
 *
 * `{"bots":[{"bot":<seat>,"move":<one of the seven>,"target"?:"rider"|<seat>,"effort"?:<one of four>}]}`
 * and nothing else. **There is no power field**, nor any number but a seat
 * (D-3.1); the effort is a word from a closed list (ADR 0073 D-2.5). {@link readModelTacticsAnswer} reads it field by field: a key the
 * schema does not name anywhere makes the whole answer invalid, so a model that
 * writes `"watts": 900` has said nothing; so does a move outside the seven, a
 * seat outside the field, a seat named twice, text that is not JSON, or an
 * answer longer than {@link MODEL_TACTICS_ANSWER_MOST_CHARACTERS} (D-3.2). A
 * bot the answer does not name keeps its seeded move.
 *
 * Written fresh for #2709 (ADR 0071 D-8.7): the spike's AGPL copy under
 * `apps/web/tools/model-tactics-spike/` is not moved.
 */

import { isCourseHill, type CourseHill } from '../route/course-ahead';
import { nextUnit, raceRandom } from './random';
import { BOT_EFFORTS, BOT_TACTICS, type BotEffort, type BotTactic } from './tactics';

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

/**
 * **The racing styles a bot is dealt** (ADR 0073 D-5.1): how it likes to race,
 * apart from what its legs are good at. A `sprinter` is a wheel-sitter who
 * waits for the line; the instance's prompt says what each of the others does.
 */
export const MODEL_RACING_STYLES = [
  'breakaway',
  'sprinter',
  'climber',
  'rouleur',
  'opportunist',
] as const;

/** One of {@link MODEL_RACING_STYLES}. */
export type ModelRacingStyle = (typeof MODEL_RACING_STYLES)[number];

/** What the styles' deal mixes into the race's seed, so it draws apart from every other draw. */
const STYLE_SALT = 0x5717_1e5d;

/**
 * Each of `count` seats its racing style, dealt from the race's `seed` (ADR
 * 0073 D-5.1): every style once before any twice, in an order the seed
 * shuffles, so a field of seven holds all five and the same seed deals the
 * same field. ADR 0073 dealt it apart from the bots' archetypes (D-9 R-4);
 * since #2759 (ADR 0076 D-3) a race with AI bots deals each bot the pace and
 * body its style fits on these styles (`model-field.ts` §`modelFieldPaces`).
 */
export function modelRacingStyles(seed: number, count: number): readonly ModelRacingStyle[] {
  const deck = Array.from(
    { length: count },
    (_, at) => MODEL_RACING_STYLES[at % MODEL_RACING_STYLES.length] as ModelRacingStyle,
  );
  let random = raceRandom((raceRandom(seed).state ^ STYLE_SALT) >>> 0);
  // A Fisher–Yates shuffle from the seeded generator.
  for (let at = deck.length - 1; at > 0; at -= 1) {
    const drawn = nextUnit(random);
    random = drawn.next;
    const swap = Math.floor(drawn.value * (at + 1));
    [deck[at], deck[swap]] = [deck[swap] as ModelRacingStyle, deck[at] as ModelRacingStyle];
  }
  return deck;
}

/**
 * **How a bot compares with the rest of its field**, in plain words (#2759,
 * ADR 0076 D-4): on the flat, on a climb, in a sprint and in its punch, each
 * one of these. `model-field.ts` §`modelFieldStrengths` says which.
 */
export const MODEL_STRENGTH_WORDS = ['weak', 'average', 'strong'] as const;

/** One of {@link MODEL_STRENGTH_WORDS}. */
export type ModelStrengthWord = (typeof MODEL_STRENGTH_WORDS)[number];

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
  /**
   * How it likes to race, dealt from the race's seed (ADR 0073 D-5.1). Since
   * ADR 0076 D-3 it also decides the bot's legs, its archetype, which is
   * therefore not sent (D-11).
   */
  readonly style: ModelRacingStyle;
  /** Beside the rest of the field, on the flat: its watts at threshold (ADR 0076 D-4). */
  readonly flat: ModelStrengthWord;
  /** Beside the rest of the field, on a climb: its watts per kilogram at threshold. */
  readonly climb: ModelStrengthWord;
  /** Beside the rest of the field, in a sprint: its peak watts. */
  readonly sprint: ModelStrengthWord;
  /** Beside the rest of the field, its punch: how much it can spend above threshold (W′). */
  readonly punch: ModelStrengthWord;
  /** Its place in the race, from 1. */
  readonly rank: number;
  /** Who is directly ahead: `"rider"`, another bot's seat, or `null` when it leads (#2708). */
  readonly ahead: 'rider' | number | null;
  /** The move of the bot directly ahead, or `null` when that is the rider or nobody (#2708). */
  readonly aheadMove: BotTactic | null;
  /** Metres to the racer directly ahead, or `null` when it leads: whole metres from the device. */
  readonly gapAheadM: number | null;
  /** Metres to the racer directly behind, or `null` when it is last: whole metres from the device. */
  readonly gapBehindM: number | null;
  /** Its W′ balance as a share of its W′, 0 to 1: to a tenth from the device. */
  readonly wbal: number;
  /** Whether it is blown (ADR 0073 D-5.4): its W′ ran out, and it rides no harder than CP until it has refilled. */
  readonly blown: boolean;
  readonly drafting: boolean;
  /** The move it is riding now. */
  readonly move: BotTactic;
  /** Whole seconds it has held {@link move}, 0 on the line (#2708). */
  readonly secondsInMove: number;
  readonly lapsLeft: number;
  /**
   * Metres to the finish line **as the bot reads them** (ADR 0073 D-3.5): the
   * true distance plus its skill's misjudgement for the window
   * (`archetype.ts` §`botTacticsMisjudgement`), the reading seeded
   * `decideTactic` launches on.
   */
  readonly toLineM: number;
  /** Where its legs would usually launch the sprint, metres to the line: a guide, not a rule (D-3.5). */
  readonly launchM: number;
  /** The grade 50 m up the road, percent: a whole percent from the device. */
  readonly gradeAheadPct: number;
  /** Metres the rider is ahead of the bot, below 0 behind it: whole metres from the device. */
  readonly riderGapM: number;
}

/** The race as the model is shown it at one instant. */
export interface ModelTacticsInput {
  readonly laps: number;
  /** Whole seconds since any bot was last attacking or on a flyer, or since the start (#2708). */
  readonly quietS: number;
  /** The rider's state (ADR 0073 D-5.2), so a bot can mark them. */
  readonly rider: ModelTacticsRiderView;
  readonly bots: readonly ModelTacticsBotView[];
  /**
   * The road ahead of the leading bot (#2794): once for the race, not once a
   * bot, to keep the input small. Optional, so a device from before it still
   * asks; every device since sends it.
   */
  readonly course?: ModelTacticsCourse;
}

/**
 * **The course ahead of the leading bot**, as the model is shown it (#2794),
 * from `route/course-ahead.ts`: a bot behind the leader is its gap further
 * from each place named. Metres to 10 m, grades to a whole percent.
 */
export interface ModelTacticsCourse {
  /** The next climb up the road (at least 3 % for at least 200 m), or `null` with none in 5 km before the line. */
  readonly climb: CourseHill | null;
  /** The next descent, by the same rule downhill, or `null`. */
  readonly descent: CourseHill | null;
  /** Metres left in the leader's lap. */
  readonly lapLeftM: number;
  /** Metres of climbing left in the leader's lap. */
  readonly lapClimbM: number;
  /**
   * The average grade of the last 500 m to the line, whole percent: whether
   * the finish is flat, up or down. The last lap is a bot's `lapsLeft` of 1.
   */
  readonly finishPct: number;
}

/** The rider as the model is shown them (ADR 0073 D-5.2). */
export interface ModelTacticsRiderView {
  /** The rider's place, from 1; 0 when the rider is not racing. */
  readonly rank: number;
  readonly wPerKg: number | null;
  /** The seat of the bot directly ahead of the rider, or `null` when the rider leads or is not racing. */
  readonly ahead: number | null;
  /** Metres to the racer directly ahead of the rider, or `null`. */
  readonly gapAheadM: number | null;
  /** Metres to the racer directly behind the rider, or `null`. */
  readonly gapBehindM: number | null;
  readonly drafting: boolean;
}

/** Who a move is aimed at: the rider, or another bot by its seat. */
export type ModelTacticsTarget = 'rider' | number;

/** One bot's move in an answer. */
export interface ModelTacticsMove {
  readonly bot: number;
  readonly move: BotTactic;
  readonly target?: ModelTacticsTarget;
  /** How hard to ride it, from a closed list, never a number (ADR 0073 D-2.5, #2710). Absent: the move's own. */
  readonly effort?: BotEffort;
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
  | 'bad-target'
  | 'bad-effort';

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

/** The two moves that read a target (`model-race.ts` §`ADR_0073_MOVE_STRATEGY`): every other ignores one. */
const TARGETED_MOVES: readonly BotTactic[] = ['follow', 'chase'];

/**
 * The answer's JSON Schema for a field of `seats`, which a local model
 * server's structured output holds the model to — the target offered again
 * since ADR 0073 D-3.4 lets a `follow` or `chase` name any racer, and the
 * optional effort (D-2.5) — and which
 * {@link readModelTacticsAnswer} checks again, because a schema a server
 * enforces is not one its caller may trust.
 *
 * **Shaped for latency** (#2759, ADR 0076 D-11): a move is one of two shapes,
 * a `follow` or `chase` that may name a target and every other move, which
 * may not, because no other move reads one and each target the model writes
 * is tokens it spends time on; and the list holds at most one move a seat, so
 * a model that repeats itself stops at the end of the field instead of
 * writing to its token cap. The reader is unchanged: a target on another
 * move, were one to arrive, is still read and still ignored.
 */
export function modelTacticsAnswerSchema(
  seats: readonly number[],
): Readonly<Record<string, unknown>> {
  const move = (moves: readonly BotTactic[], targeted: boolean) => ({
    type: 'object',
    properties: {
      bot: { type: 'integer', enum: [...seats] },
      move: { type: 'string', enum: [...moves] },
      effort: { type: 'string', enum: [...BOT_EFFORTS] },
      ...(targeted
        ? {
            target: {
              anyOf: [
                { type: 'string', enum: ['rider'] },
                { type: 'integer', enum: [...seats] },
              ],
            },
          }
        : {}),
    },
    required: ['bot', 'move'],
    additionalProperties: false,
  });
  return {
    type: 'object',
    properties: {
      bots: {
        type: 'array',
        maxItems: seats.length,
        items: {
          anyOf: [
            move(
              BOT_TACTICS.filter((tactic) => !TARGETED_MOVES.includes(tactic)),
              false,
            ),
            move(TARGETED_MOVES, true),
          ],
        },
      },
    },
    required: ['bots'],
    additionalProperties: false,
  };
}

const ANSWER_KEYS: ReadonlySet<string> = new Set(['bots']);
const MOVE_KEYS: ReadonlySet<string> = new Set(['bot', 'move', 'target', 'effort']);

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
    const { bot, move, target, effort } = entry;
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
    // A `null` effort is no effort, as an absent one is.
    if (
      effort !== undefined &&
      effort !== null &&
      !(typeof effort === 'string' && (BOT_EFFORTS as readonly string[]).includes(effort))
    ) {
      return { ok: false, reason: 'bad-effort' };
    }
    moves.push({
      bot,
      move: move as BotTactic,
      ...(target === undefined || target === null ? {} : { target }),
      ...(effort === undefined || effort === null ? {} : { effort: effort as BotEffort }),
    });
  }
  return { ok: true, moves };
}

const VIEW_KEYS = [
  'bot',
  'style',
  'flat',
  'climb',
  'sprint',
  'punch',
  'rank',
  'ahead',
  'aheadMove',
  'gapAheadM',
  'gapBehindM',
  'wbal',
  'blown',
  'drafting',
  'move',
  'secondsInMove',
  'lapsLeft',
  'toLineM',
  'launchM',
  'gradeAheadPct',
  'riderGapM',
] as const;
const INPUT_KEYS = ['laps', 'quietS', 'rider', 'bots'] as const;
/** The keys a race state may leave out: each one a device from before it did not send. */
const OPTIONAL_INPUT_KEYS = ['course'] as const;
const COURSE_KEYS = ['climb', 'descent', 'lapLeftM', 'lapClimbM', 'finishPct'] as const;
/** The most seconds a race state may say: a day. */
const MOST_SECONDS = 86_400;
const RIDER_KEYS = ['rank', 'wPerKg', 'ahead', 'gapAheadM', 'gapBehindM', 'drafting'] as const;

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
      typeof view.style === 'string' &&
        (MODEL_RACING_STYLES as readonly string[]).includes(view.style),
      'must be a racing style',
    ],
    ...(['flat', 'climb', 'sprint', 'punch'] as const).map(
      (key) =>
        [
          key,
          typeof view[key] === 'string' &&
            (MODEL_STRENGTH_WORDS as readonly string[]).includes(view[key]),
          'must be a strength word',
        ] as const,
    ),
    ['rank', wholeIn(view.rank, 1, MODEL_TACTICS_MOST_SEATS + 1), 'must be a place in the field'],
    [
      'ahead',
      view.ahead === null ||
        view.ahead === 'rider' ||
        wholeIn(view.ahead, 0, MODEL_TACTICS_MOST_SEATS - 1),
      'must be "rider", a seat, or null',
    ],
    [
      'aheadMove',
      view.aheadMove === null ||
        (typeof view.aheadMove === 'string' &&
          (BOT_TACTICS as readonly string[]).includes(view.aheadMove)),
      'must be one of the seven moves, or null',
    ],
    ['gapAheadM', gap(view.gapAheadM), 'must be metres, or null'],
    ['gapBehindM', gap(view.gapBehindM), 'must be metres, or null'],
    ['wbal', numberIn(view.wbal, 0, 1), 'must be a share from 0 to 1'],
    ['blown', typeof view.blown === 'boolean', 'must be a boolean'],
    ['drafting', typeof view.drafting === 'boolean', 'must be a boolean'],
    [
      'move',
      typeof view.move === 'string' && (BOT_TACTICS as readonly string[]).includes(view.move),
      'must be one of the seven moves',
    ],
    [
      'secondsInMove',
      wholeIn(view.secondsInMove, 0, MOST_SECONDS),
      'must be a whole number of seconds',
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

/** The first problem with the course ahead (#2794), or `undefined`. */
function courseProblem(course: unknown): ModelTacticsInputProblem | undefined {
  if (!isRecord(course)) return { field: 'input.course', problem: 'must be an object' };
  const keys = keyProblem(course, COURSE_KEYS, 'input.course');
  if (keys !== undefined) return keys;
  const checks: readonly (readonly [string, boolean, string])[] = [
    ['climb', course.climb === null || isCourseHill(course.climb), 'must be a hill, or null'],
    ['descent', course.descent === null || isCourseHill(course.descent), 'must be a hill, or null'],
    ['lapLeftM', numberIn(course.lapLeftM, 0, MOST_METRES), 'must be metres'],
    ['lapClimbM', numberIn(course.lapClimbM, 0, MOST_METRES), 'must be metres'],
    ['finishPct', numberIn(course.finishPct, -100, 100), 'must be a grade in percent'],
  ];
  const failed = checks.find(([, ok]) => !ok);
  return failed === undefined
    ? undefined
    : { field: `input.course.${failed[0]}`, problem: failed[2] };
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
  const keys = keyProblem(
    value,
    [...INPUT_KEYS, ...OPTIONAL_INPUT_KEYS.filter((key) => key in value)],
    'input',
  );
  if (keys !== undefined) return { ok: false, problem: keys };
  if (!wholeIn(value.laps, 1, MOST_LAPS)) return refuse('input.laps', 'must be a number of laps');
  if (!wholeIn(value.quietS, 0, MOST_SECONDS)) {
    return refuse('input.quietS', 'must be a whole number of seconds');
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
  if (rider.ahead !== null && !wholeIn(rider.ahead, 0, MODEL_TACTICS_MOST_SEATS - 1)) {
    return refuse('input.rider.ahead', 'must be a seat, or null');
  }
  for (const key of ['gapAheadM', 'gapBehindM'] as const) {
    if (rider[key] !== null && !numberIn(rider[key], 0, MOST_METRES)) {
      return refuse(`input.rider.${key}`, 'must be metres, or null');
    }
  }
  if (typeof rider.drafting !== 'boolean') {
    return refuse('input.rider.drafting', 'must be a boolean');
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
  if ('course' in value) {
    const problem = courseProblem(value.course);
    if (problem !== undefined) return { ok: false, problem };
  }
  return { ok: true, value: value as unknown as ModelTacticsInput };
}
